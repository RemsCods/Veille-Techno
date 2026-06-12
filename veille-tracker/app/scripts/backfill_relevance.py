"""
Backfill relevance fields for already-collected articles.

Computes the contrastive margin (positive vs negative anchors, see
relevance.py) for every article that has an embedding, and fills:
relevance, relevance_score, relevance_reason.

The pipeline STATUS is left untouched: these articles are already
enriched/scored. Only the classification changes — the feed filters on
`relevance`, so backfilled spam disappears from the default view while
remaining in the DB (auditable, reversible).

Articles with a human feedback verdict are skipped (human wins).

Run inside the app container:
    docker exec veille-tracker-app-1 python scripts/backfill_relevance.py [--dry-run]

Self-contained on purpose (raw SQL): must run in a container built before
the relevance feature existed.
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sqlalchemy import text
from database import SessionLocal
from ollama_client import embed, bytes_to_vector

T_LOW  = float(os.environ.get("RELEVANCE_T_LOW",  "-0.12"))
T_HIGH = float(os.environ.get("RELEVANCE_T_HIGH", "0.05"))


def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def bucket(margin: float) -> str:
    if margin < T_LOW:
        return "off_topic"
    if margin < T_HIGH:
        return "borderline"
    return "on_topic"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        anchors = db.execute(text(
            "SELECT phrase, polarity FROM topic_anchors WHERE active = 1"
        )).fetchall()
        pos_rows = [(p, unit(np.array(embed(p), dtype=np.float32)))
                    for p, pol in anchors if pol == "positive"]
        neg_vecs = [unit(np.array(embed(p), dtype=np.float32))
                    for p, pol in anchors if pol == "negative"]
        if not pos_rows or not neg_vecs:
            print("Missing positive or negative anchors — aborting.")
            return
        pos_phrases = [p for p, _ in pos_rows]
        pos = np.stack([v for _, v in pos_rows])
        neg = np.stack(neg_vecs)
        print(f"{len(pos_phrases)} positive / {len(neg_vecs)} negative anchors "
              f"· thresholds {T_LOW:+.2f} / {T_HIGH:+.2f}")

        rows = db.execute(text("""
            SELECT e.article_id, e.vec_data
            FROM embeddings e
            JOIN articles a ON a.id = e.article_id
            LEFT JOIN feedback f ON f.article_id = a.id
            WHERE f.article_id IS NULL
        """)).fetchall()
        # End the read transaction — the pipeline keeps updating articles
        # concurrently and a long-lived snapshot triggers MariaDB error 1020
        # ("Record has changed since last read") on our UPDATEs.
        db.commit()
        print(f"Backfilling {len(rows)} articles…")

        # Phase 1: compute everything in memory (no open transaction)
        counts = {"on_topic": 0, "borderline": 0, "off_topic": 0}
        updates = []
        for article_id, vec_data in rows:
            v = unit(np.array(bytes_to_vector(vec_data), dtype=np.float32))
            sims_pos = pos @ v
            best_i = int(np.argmax(sims_pos))
            margin = float(sims_pos[best_i]) - float(np.max(neg @ v))
            b = bucket(margin)
            counts[b] += 1
            display = round(min(max(50 + margin * 250, 0.0), 100.0), 1)
            reason = (f"ancre la plus proche : « {pos_phrases[best_i]} » "
                      f"(marge {margin:+.2f}) · backfill")[:500]
            updates.append({"b": b, "s": display, "r": reason, "id": article_id})

        # Phase 2: apply in short transactions (200 rows each, retry on 1020)
        if not args.dry_run:
            applied = 0
            for i in range(0, len(updates), 200):
                chunk = updates[i:i + 200]
                for attempt in (1, 2, 3):
                    try:
                        for u in chunk:
                            db.execute(text("""
                                UPDATE articles
                                SET relevance = :b, relevance_score = :s, relevance_reason = :r
                                WHERE id = :id
                            """), u)
                        db.commit()
                        applied += len(chunk)
                        break
                    except Exception as exc:
                        db.rollback()
                        if attempt == 3:
                            print(f"  chunk {i} failed after 3 attempts: {exc}")
            print(f"Applied {applied}/{len(updates)} updates.")

        total = sum(counts.values()) or 1
        print(f"\n{'DRY RUN — ' if args.dry_run else ''}Result:")
        for b, n in counts.items():
            print(f"  {b:<11} {n:5d}  ({n / total * 100:.1f}%)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
