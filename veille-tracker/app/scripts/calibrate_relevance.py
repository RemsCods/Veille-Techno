"""
Calibrate the relevance gate thresholds on the real corpus.

Computes max cosine similarity (article embedding vs topic anchors) for every
embedded article, then prints the score distribution, per-source averages and
the extremes — so T_LOW / T_HIGH are chosen from measured data, not invented.

Run inside the app container:
    docker exec veille-tracker-app-1 python scripts/calibrate_relevance.py

Self-contained on purpose (raw SQL, no ORM models): it must run in a container
built BEFORE the relevance feature existed.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sqlalchemy import text
from database import SessionLocal
from ollama_client import embed, bytes_to_vector


def main():
    db = SessionLocal()
    try:
        anchors = [r[0] for r in db.execute(
            text("SELECT phrase FROM topic_anchors WHERE active = 1")
        ).fetchall()]
        if not anchors:
            print("No active anchors — aborting.")
            return

        print(f"Embedding {len(anchors)} anchors…")
        anchor_matrix = []
        for phrase in anchors:
            v = np.array(embed(phrase), dtype=np.float32)
            anchor_matrix.append(v / np.linalg.norm(v))
        anchor_matrix = np.stack(anchor_matrix)          # (A, 768)

        rows = db.execute(text("""
            SELECT e.article_id, e.vec_data, s.name, a.title
            FROM embeddings e
            JOIN articles a ON a.id = e.article_id
            JOIN sources  s ON s.id = a.source_id
        """)).fetchall()
        print(f"Scoring {len(rows)} embedded articles…\n")

        scores, by_source, items = [], {}, []
        for article_id, vec_data, source, title in rows:
            v = np.array(bytes_to_vector(vec_data), dtype=np.float32)
            n = np.linalg.norm(v)
            if n == 0:
                continue
            sim = float(np.max(anchor_matrix @ (v / n)))
            scores.append(sim)
            by_source.setdefault(source, []).append(sim)
            items.append((sim, source, (title or "")[:70]))

        scores = np.array(scores)

        print("── Global distribution (max cosine vs anchors) ──")
        for p in (1, 5, 10, 25, 50, 75, 90, 95, 99):
            print(f"  p{p:<3} {np.percentile(scores, p):.3f}")
        print(f"  mean {scores.mean():.3f}  min {scores.min():.3f}  max {scores.max():.3f}")

        print("\n── Histogram ──")
        edges = np.arange(0.20, 0.80, 0.05)
        hist, _ = np.histogram(scores, bins=edges)
        for i, count in enumerate(hist):
            bar = "#" * int(count / max(hist.max(), 1) * 50)
            print(f"  {edges[i]:.2f}–{edges[i+1]:.2f}  {count:5d}  {bar}")

        print("\n── Per-source mean (sorted) ──")
        for source, vals in sorted(by_source.items(), key=lambda kv: np.mean(kv[1])):
            v = np.array(vals)
            print(f"  {np.mean(v):.3f}  (p10 {np.percentile(v, 10):.3f})  {source}  [{len(v)}]")

        items.sort()
        print("\n── 20 LOWEST scores (should be the spam) ──")
        for sim, source, title in items[:20]:
            print(f"  {sim:.3f}  [{source}] {title}")

        print("\n── 10 HIGHEST scores (sanity check) ──")
        for sim, source, title in items[-10:]:
            print(f"  {sim:.3f}  [{source}] {title}")

        # Known-spam probe: obvious junk title patterns observed in Dev.to
        print("\n── Known-spam probe (title patterns) ──")
        spam_rows = db.execute(text("""
            SELECT e.vec_data, a.title FROM embeddings e
            JOIN articles a ON a.id = e.article_id
            WHERE a.title REGEXP 'paypal|casino|betting|UFC|spa |verified account|crypto trading|gaming untuk'
        """)).fetchall()
        spam_scores = []
        for vec_data, title in spam_rows:
            v = np.array(bytes_to_vector(vec_data), dtype=np.float32)
            n = np.linalg.norm(v)
            if n:
                spam_scores.append((float(np.max(anchor_matrix @ (v / n))), title[:60]))
        spam_scores.sort(reverse=True)
        for sim, title in spam_scores[:15]:
            print(f"  {sim:.3f}  {title}")
        if spam_scores:
            arr = np.array([s for s, _ in spam_scores])
            print(f"  → spam: mean {arr.mean():.3f}, max {arr.max():.3f}, n={len(arr)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
