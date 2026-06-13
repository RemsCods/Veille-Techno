"""Shared helper: record a per-article pipeline failure.

Increments articles.error_count and stores the last message. Once error_count
reaches MAX_PIPELINE_ATTEMPTS the workers stop claiming the article (see the
claim queries in relevance_gate / enricher / scorer), so a "poison" article is
parked instead of being retried every cycle forever. Call AFTER db.rollback().
"""

from models import Article


def bump_error(db, article_id: int, message: str) -> None:
    try:
        a = db.get(Article, article_id)
        if a is not None:
            a.error_count = (a.error_count or 0) + 1
            a.last_error = (message or "")[:500]
            db.commit()
    except Exception:
        db.rollback()
