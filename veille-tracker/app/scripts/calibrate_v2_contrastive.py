"""
Calibration v2 — contrastive anchors.

V1 finding: absolute cosine vs positive anchors does NOT separate spam from
legit content (PayPal spam ~0.55 sits mid-distribution; lowest scores are
legitimate non-English articles). Root cause: nomic cosine space is compressed
(0.39-0.82) and "Buy Verified PayPal Accounts" is lexically tech-adjacent.

V2 hypothesis: the MARGIN max_cos(positive anchors) - max_cos(negative
anchors) separates far better, because it is relative (immune to the global
compression and to language effects).

This script tests the hypothesis on the real corpus before any threshold is
committed.
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sqlalchemy import text
from database import SessionLocal
from ollama_client import embed, bytes_to_vector

POSITIVE = [
    'large language models, LLM releases, benchmarks and evaluations',
    'machine learning research, neural network architectures, training techniques',
    'AI products, APIs and developer tools from AI companies',
    'open-source AI models, local inference, quantization, GPU optimization',
    'AI safety, alignment, governance and regulation',
    'embeddings, retrieval-augmented generation, vector databases, semantic search',
    'image, video and audio generation models, diffusion models',
    'speech recognition, text-to-speech, multimodal models',
    'AI agents, autonomous systems, tool use, agentic workflows',
    'AI industry news: funding, acquisitions, partnerships, company announcements',
]

NEGATIVE = [
    'buy verified accounts for sale, PayPal Cash App crypto exchange account marketplace',
    'online casino, sports betting tips, gambling promotions and game predictions',
    'spa, massage, beauty salon, restaurant and travel recommendations',
    'cryptocurrency trading guide, exchange account verification, investment signals',
    'affiliate marketing income schemes, SEO link building, make money online fast',
    'personal development, spirituality, lifestyle and wellness coaching',
    'corporate shareholder meetings, stock market announcements unrelated to technology',
    'sports match previews, team news and player transfers',
]


def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def main():
    db = SessionLocal()
    try:
        print("Embedding anchors…")
        pos = np.stack([unit(np.array(embed(p), dtype=np.float32)) for p in POSITIVE])
        neg = np.stack([unit(np.array(embed(p), dtype=np.float32)) for p in NEGATIVE])

        rows = db.execute(text("""
            SELECT e.article_id, e.vec_data, s.name, a.title
            FROM embeddings e
            JOIN articles a ON a.id = e.article_id
            JOIN sources  s ON s.id = a.source_id
        """)).fetchall()
        print(f"Scoring {len(rows)} articles…\n")

        margins, items = [], []
        for article_id, vec_data, source, title in rows:
            v = unit(np.array(bytes_to_vector(vec_data), dtype=np.float32))
            p = float(np.max(pos @ v))
            n = float(np.max(neg @ v))
            m = p - n
            margins.append(m)
            items.append((m, p, n, source, (title or "")[:65]))

        margins = np.array(margins)
        print("── Margin distribution (pos − neg) ──")
        for pc in (1, 2, 5, 10, 25, 50, 75, 90, 99):
            print(f"  p{pc:<3} {np.percentile(margins, pc):+.3f}")

        print("\n── Histogram ──")
        edges = np.arange(-0.30, 0.35, 0.05)
        hist, _ = np.histogram(margins, bins=edges)
        for i, count in enumerate(hist):
            bar = "#" * int(count / max(hist.max(), 1) * 50)
            print(f"  {edges[i]:+.2f}…{edges[i+1]:+.2f}  {count:5d}  {bar}")

        items.sort()
        print("\n── 25 LOWEST margins (spam should now be here) ──")
        for m, p, n, source, title in items[:25]:
            print(f"  {m:+.3f} (p{p:.2f}/n{n:.2f}) [{source}] {title}")

        print("\n── Around margin 0 (the borderline zone) ──")
        mid = [it for it in items if -0.01 <= it[0] <= 0.01][:12]
        for m, p, n, source, title in mid:
            print(f"  {m:+.3f} (p{p:.2f}/n{n:.2f}) [{source}] {title}")

        # Known spam probe
        print("\n── Known-spam probe (PayPal/casino/UFC/spa titles) ──")
        spam_rows = db.execute(text("""
            SELECT e.vec_data, a.title FROM embeddings e
            JOIN articles a ON a.id = e.article_id
            WHERE a.title REGEXP 'paypal|casino|betting|UFC|spa |verified account|crypto trading|gaming untuk|rajabandot|shadow work'
        """)).fetchall()
        spam_m = []
        for vec_data, title in spam_rows:
            v = unit(np.array(bytes_to_vector(vec_data), dtype=np.float32))
            spam_m.append((float(np.max(pos @ v)) - float(np.max(neg @ v)), title[:60]))
        spam_m.sort(reverse=True)
        for m, title in spam_m:
            print(f"  {m:+.3f}  {title}")
        if spam_m:
            arr = np.array([m for m, _ in spam_m])
            print(f"  → spam margins: mean {arr.mean():+.3f}, MAX {arr.max():+.3f} (worst case), n={len(arr)}")

        # Non-English legit probe (the v1 false-positive victims)
        print("\n── Non-English legit probe ──")
        for pat in ("从LLM", "輕鬆開發", "Nemotron-Personas", "ĐẠI HỘI"):
            r = db.execute(text(
                "SELECT e.vec_data, a.title FROM embeddings e JOIN articles a ON a.id=e.article_id "
                "WHERE a.title LIKE :p LIMIT 1"), {"p": f"%{pat}%"}).fetchone()
            if r:
                v = unit(np.array(bytes_to_vector(r[0]), dtype=np.float32))
                m = float(np.max(pos @ v)) - float(np.max(neg @ v))
                print(f"  {m:+.3f}  {r[1][:60]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
