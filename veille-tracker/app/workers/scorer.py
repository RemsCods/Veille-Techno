import threading
from database import SessionLocal
from models import Article
from confidence import compute_confidence
from config import CURRENT_PIPELINE_VERSION, MAX_PIPELINE_ATTEMPTS
from workers._errors import bump_error as _bump_error
from pipeline_stats import stats as _stats

# Lock held only during the claim step (milliseconds), not during LLM calls.
_claim_lock = threading.Lock()
_claimed_ids: set[int] = set()


def run_scorer(batch: int = 25) -> int:
    """
    Claim a batch of articles atomically (in-memory set, no DB status change),
    then score each one. Concurrent scorer threads pick disjoint articles.
    On crash/restart the in-memory set resets and articles remain 'enrichi' in DB,
    so they are safely re-scored on the next run (scoring is idempotent).
    """
    # ── Step 1: claim article IDs atomically ─────────────────────────────
    with _claim_lock:
        db = SessionLocal()
        try:
            q = db.query(Article.id).filter(
                Article.status == "enrichi",
                Article.error_count < MAX_PIPELINE_ATTEMPTS,   # skip parked articles
            )
            if _claimed_ids:
                q = q.filter(Article.id.notin_(_claimed_ids))
            ids = [r[0] for r in q.limit(batch).all()]
            _claimed_ids.update(ids)
        except Exception:
            ids = []
        finally:
            db.close()

    if not ids:
        return 0

    # ── Step 2: score each claimed article (slow LLM calls, no lock) ─────
    _stats.adjust_scoring_active(len(ids))
    count = 0
    db = SessionLocal()
    try:
        for article_id in ids:
            article = db.get(Article, article_id)
            if not article:
                continue
            try:
                article.confidence_score = compute_confidence(article, db)
                article.status = "score"
                article.error_count = 0   # success → reset consecutive-failure counter
                # Stamp the version that produced this score (terminal state):
                # marks it as processed by the current pipeline so the idle
                # reviewer won't re-pick it until CURRENT_PIPELINE_VERSION bumps.
                article.pipeline_version = CURRENT_PIPELINE_VERSION
                db.commit()
                count += 1
                _stats.record_scored()
            except Exception as exc:
                db.rollback()
                _stats.record_score_error(article_id, f"{type(exc).__name__}: {exc}")
                _bump_error(db, article_id, f"score: {type(exc).__name__}: {exc}")
    finally:
        _stats.adjust_scoring_active(-len(ids))
        with _claim_lock:
            _claimed_ids.difference_update(ids)
        db.close()

    return count
