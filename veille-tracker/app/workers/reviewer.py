"""
Idle re-review worker.

Much of the corpus was scored by OLDER pipeline versions (old confidence
formula, single-model fact-check, and no LLM relevance verdict — the v2 enrich
prompt that returns one is recent). The relevance backfill only recomputed the
`relevance*` columns; it never re-enriched or re-scored those articles, so their
score is not "at its fair value".

This worker is called ONLY from the idle branch of the continuous pipeline
(scheduler._continuous_pipeline), i.e. when there is nothing else to process.
It re-injects a small, fair flow of legacy scored articles back into the
pipeline by resetting them to 'pertinent' — they then flow through the existing
enricher → scorer, which re-enrich, re-score, and stamp the current pipeline
version (workers/enricher.py, workers/scorer.py).

Fairness ("never review one twice while others were never reviewed"):
  ORDER BY reviewed_at ASC  → MariaDB sorts NULLs first, so never-reviewed
  articles go before any already-reviewed one. A re-injected article gets its
  reviewed_at stamped immediately, so even if its re-processing fails and it
  falls back to 'score' with an old version, it queues behind all never-reviewed
  articles instead of starving them. Once re-scored it reaches
  CURRENT_PIPELINE_VERSION and leaves the eligible pool entirely.

Self-throttling: re-injecting makes the pipeline non-idle on the next loop
(articles are now 'pertinent'), so no more are injected until the batch drains.
As soon as a real collection arrives, the reviewer pauses on its own.
"""

from datetime import datetime
from database import SessionLocal
from models import Article
from config import CURRENT_PIPELINE_VERSION
from pipeline_stats import stats as _stats


def run_reviewer(batch: int = 8) -> int:
    """
    Re-inject up to `batch` legacy scored articles for re-enrichment + re-scoring.
    Returns the number of articles re-injected (0 when the corpus is fully up to date).

    Single-threaded by contract (called only from the idle branch), so no
    concurrent-claim handling is needed.
    """
    db = SessionLocal()
    try:
        # Yield to freshly-collected work: never inject re-review while any fresh
        # article (reviewed_at NULL) is still flowing through the funnel.
        fresh_pending = (
            db.query(Article.id)
            .filter(
                Article.status.in_(["collecte", "pertinent", "processing", "enrichi"]),
                Article.reviewed_at.is_(None),
            )
            .first()
        )
        if fresh_pending:
            return 0

        ids = [
            r[0]
            for r in (
                db.query(Article.id)
                .filter(
                    Article.status == "score",
                    Article.pipeline_version < CURRENT_PIPELINE_VERSION,
                )
                .order_by(Article.reviewed_at.asc(), Article.id.asc())  # NULLs (never reviewed) first
                .limit(batch)
                .all()
            )
        ]
        if not ids:
            return 0

        # Remember the current score (old→new display), stamp the review time,
        # and send the article back through the pipeline at the 'pertinent'
        # stage — embeddings/relevance from the gate are reused (no re-embed).
        # confidence_score is intentionally NOT cleared: the feed keeps showing
        # the old score until the scorer writes the new one.
        db.query(Article).filter(Article.id.in_(ids)).update(
            {
                Article.previous_confidence_score: Article.confidence_score,
                Article.reviewed_at: datetime.utcnow(),
                Article.status: "pertinent",
            },
            synchronize_session=False,
        )
        db.commit()
        _stats.record_reviewed(len(ids))
        return len(ids)
    except Exception:
        db.rollback()
        return 0
    finally:
        db.close()
