"""
Re-score confidence_score for every 'score' article with the CURRENT formula,
WITHOUT any LLM call — reuses stored fact_checks, recomputes corroboration with
the article-centered window, and applies the softened recency (see confidence.py).

Why: the now-anchored corroboration window + the old hard recency=0 compressed
the re-review backlog into 46–66 (nothing reliable). New articles already use the
fixed formula via confidence.py; this brings the existing corpus in line in
minutes, with zero GPU cost.

Run inside the app container:
    docker exec veille-tracker-app-1 python scripts/rescore_confidence.py [--dry-run]

Self-contained on purpose (own corroboration calc, no DB writes except the final
confidence_score UPDATE) so --dry-run is truly read-only.
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sqlalchemy import text
from database import SessionLocal
from models import Article
from config import settings
from ollama_client import bytes_to_vector
from confidence import (
    score_source, score_fact_check_from_stored, score_freshness, _get_vec_cache,
)


def _corr_score(article, cache, window_s):
    """Corroboration score from the in-memory cache, article-centered window, NO writes."""
    if not article.embedding:
        return 30.0
    vec_a = np.array(bytes_to_vector(article.embedding.vec_data), dtype=np.float32)
    a_time = article.collected_at
    cand = [
        vec
        for art_id, source_id, collected_at, vec in cache
        if art_id != article.id
        and source_id != article.source_id
        and (collected_at is None or a_time is None
             or abs((collected_at - a_time).total_seconds()) <= window_s)
    ]
    if not cand:
        return 30.0
    matrix = np.stack(cand)
    na = np.linalg.norm(vec_a)
    nb = np.linalg.norm(matrix, axis=1)
    denom = nb * na
    sims = np.where(denom > 0, (matrix @ vec_a) / denom, 0.0)
    n = int(np.sum(sims >= settings.corroboration_cosine_threshold))
    return {0: 30.0, 1: 55.0, 2: 75.0, 3: 90.0}.get(n, 100.0)


def _buckets(scores):
    b = {"0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0}
    for s in scores:
        if   s < 20: b["0-20"]   += 1
        elif s < 40: b["20-40"]  += 1
        elif s < 60: b["40-60"]  += 1
        elif s < 80: b["60-80"]  += 1
        else:        b["80-100"] += 1
    return b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    window_s = settings.corroboration_window_hours * 3600
    try:
        cache = _get_vec_cache(db)
        ids = [r[0] for r in db.execute(text("SELECT id FROM articles WHERE status='score'")).fetchall()]
        print(f"Re-scoring {len(ids)} articles · corroboration window ±{settings.corroboration_window_hours}h "
              f"· {'DRY RUN' if args.dry_run else 'APPLY'}")

        old_scores, new_scores, updates = [], [], []
        for aid in ids:
            a = db.get(Article, aid)
            if not a:
                continue
            old = a.confidence_score or 0.0
            new = round(
                0.40 * score_source(a)
                + 0.30 * _corr_score(a, cache, window_s)
                + 0.20 * score_fact_check_from_stored(a)
                + 0.10 * score_freshness(a),
                1,
            )
            old_scores.append(old)
            new_scores.append(new)
            updates.append((aid, new))
            db.expunge(a)   # detach so the (large) content can be GC'd
        db.rollback()       # end the read snapshot before the write phase

        print(f"BEFORE: {_buckets(old_scores)}")
        print(f"AFTER : {_buckets(new_scores)}")
        print(f"reliable (>=70): {sum(s >= 70 for s in old_scores)} -> {sum(s >= 70 for s in new_scores)}")
        if old_scores:
            print(f"avg {sum(old_scores)/len(old_scores):.1f} -> {sum(new_scores)/len(new_scores):.1f} · "
                  f"min {min(old_scores):.1f}->{min(new_scores):.1f} · max {max(old_scores):.1f}->{max(new_scores):.1f}")

        if not args.dry_run:
            applied = 0
            for i in range(0, len(updates), 200):
                chunk = updates[i:i + 200]
                for attempt in (1, 2, 3):
                    try:
                        for aid, s in chunk:
                            db.execute(text("UPDATE articles SET confidence_score = :s WHERE id = :id"),
                                       {"s": s, "id": aid})
                        db.commit()
                        applied += len(chunk)
                        break
                    except Exception as exc:
                        db.rollback()
                        if attempt == 3:
                            print(f"  chunk {i} failed after 3 attempts: {exc}")
            print(f"Applied {applied}/{len(updates)} updates.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
