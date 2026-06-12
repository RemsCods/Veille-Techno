"""
Relevance gate worker — first pipeline stage after collection.

collecte -> [embed + anchor similarity] -> pertinent | hors_sujet

Off-topic articles are stopped HERE, before the expensive LLM stages
(1 enrich call + 2 fact-check calls each). They stay in the DB with their
relevance fields filled (auditable, can be re-included), excluded from the
feed and from the corroboration index.

The embedding computed here is also THE article embedding (stored in the
embeddings table) — reused later for corroboration and the ML classifier.
"""

import threading
from database import SessionLocal
from models import Article, Embedding
from ollama_client import embed, vector_to_bytes, bytes_to_vector
from relevance import compute_relevance, bucket_from_margin
from pipeline_stats import stats as _stats
import numpy as np

# In-memory claim set (same pattern as scorer): the gate is idempotent, so a
# crash mid-batch just means the article is re-gated on the next round.
_claim_lock = threading.Lock()
_claimed_ids: set = set()


def run_relevance_gate(batch: int = 30) -> int:
    with _claim_lock:
        db = SessionLocal()
        try:
            q = db.query(Article.id).filter(Article.status == "collecte")
            if _claimed_ids:
                q = q.filter(Article.id.notin_(_claimed_ids))
            ids = [r[0] for r in q.limit(batch).all()]
            _claimed_ids.update(ids)
        except Exception:
            ids = []
        finally:
            db.close()

    if not ids:
        return _classify_stragglers(batch=10)

    count = 0
    db = SessionLocal()
    try:
        for article_id in ids:
            article = db.get(Article, article_id)
            if not article:
                continue
            try:
                _gate_article(article, db)
                count += 1
                _stats.record_gated()
            except Exception as exc:
                db.rollback()
                # Article stays in 'collecte' -> retried next round
                _stats.record_gate_error(article_id, f"{type(exc).__name__}: {exc}")
    finally:
        with _claim_lock:
            _claimed_ids.difference_update(ids)
        db.close()

    return count


def _classify_stragglers(batch: int = 10) -> int:
    """
    Catch-up pass: articles that slipped past the gate (e.g. enriched by an
    older code version, or backfill gaps) — they already have an embedding but
    relevance is NULL. Classify them from the stored vector; their pipeline
    status is left untouched.
    """
    db = SessionLocal()
    count = 0
    try:
        rows = (
            db.query(Article)
            .join(Embedding, Embedding.article_id == Article.id)
            .filter(Article.relevance.is_(None))
            .filter(Article.status.notin_(["collecte", "processing"]))
            .limit(batch)
            .all()
        )
        for article in rows:
            try:
                vec = np.array(bytes_to_vector(article.embedding.vec_data), dtype=np.float32)
                margin, display_score, anchor = compute_relevance(vec, db)
                if margin is None:
                    break  # no anchors configured — nothing to do
                article.relevance_score = display_score
                article.relevance = bucket_from_margin(margin)
                article.relevance_reason = (
                    f"ancre la plus proche : « {anchor} » (marge {margin:+.2f}) · rattrapage"
                )
                db.commit()
                count += 1
            except Exception as exc:
                db.rollback()
                _stats.record_gate_error(article.id, f"straggler: {type(exc).__name__}: {exc}")
    finally:
        db.close()
    return count


def _gate_article(article: Article, db) -> None:
    # Title + raw content excerpt — no LLM summary exists yet at this stage
    text = f"{article.title} {(article.content or '')[:600]}".strip()
    vec = embed(text)

    db.merge(Embedding(
        article_id=article.id,
        vec_data=vector_to_bytes(vec),
        model="nomic-embed-text",
        dimensions=len(vec),
    ))
    _stats.record_embedded()

    margin, display_score, anchor = compute_relevance(np.array(vec, dtype=np.float32), db)

    if margin is None:
        # No active anchors -> gate is effectively disabled, let through
        article.status = "pertinent"
        db.commit()
        return

    bucket = bucket_from_margin(margin)
    article.relevance_score = display_score
    article.relevance = bucket
    article.relevance_reason = (
        f"ancre la plus proche : « {anchor} » (marge {margin:+.2f})"
    )
    # off_topic stops here (no enrich/score); the rest waits for enrichment,
    # where the LLM gives its own verdict and merge_relevance() decides.
    article.status = "hors_sujet" if bucket == "off_topic" else "pertinent"
    db.commit()
