from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import distinct, func, text
from sqlalchemy.orm import Session
from database import get_db
from models import Article, Corroboration, FactCheck, Source, CollectLog, Embedding, Tag
from schemas import StatsOut
from config import settings, CURRENT_PIPELINE_VERSION

router = APIRouter(prefix="/stats", tags=["stats"])


# ── Public stats (Feed page) ──────────────────────────────────────────────────

@router.get("", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    total = db.query(func.count(Article.id)).scalar() or 0
    reliable = (
        db.query(func.count(Article.id))
        .filter(Article.confidence_score >= settings.reliability_threshold)
        .scalar() or 0
    )
    avg = db.query(func.avg(Article.confidence_score)).scalar()
    status_rows = db.query(Article.status, func.count(Article.id)).group_by(Article.status).all()
    by_status = {row[0]: row[1] for row in status_rows}

    return StatsOut(
        total_articles=total,
        reliable_articles=reliable,
        pct_reliable=round(reliable / total * 100, 1) if total else 0.0,
        avg_score=round(float(avg), 1) if avg is not None else None,
        articles_by_status=by_status,
    )


# ── Admin stats models ────────────────────────────────────────────────────────

class TagCountOut(BaseModel):
    name: str
    count: int


class RatePoint(BaseModel):
    enriched: float
    scored: float
    embedded: float


class SourceAdminOut(BaseModel):
    id: int
    name: str
    feed_url: str
    type: str
    reliability: int
    active: bool
    last_collected: Optional[datetime]
    article_count: int
    pipeline: dict[str, int]  # {status: count} for this source


class LogAdminOut(BaseModel):
    id: int
    source_name: str
    collected_at: datetime
    articles_fetched: int
    errors: Optional[str]


class PipelineErrorOut(BaseModel):
    stage: str                      # gate | enrich | score
    article_id: Optional[int]
    message: str
    at: str                         # ISO timestamp


class ErroredArticleOut(BaseModel):
    id: int
    title: str
    status: str
    error_count: int
    last_error: Optional[str]


class AdminStatsOut(BaseModel):
    # Pipeline counts
    pipeline: dict[str, int]
    pct_enriched: float
    pct_scored: float
    # Quality
    reliable_count: int
    pct_reliable: float
    avg_score: Optional[float]
    # Throughput
    throughput_last_hour: int
    articles_today: int
    articles_week: int
    # Live rates (last 60s sliding window)
    enriched_per_min: float
    scored_per_min: float
    embedded_per_min: float
    gated_per_min: float
    enrich_errors_per_min: float
    score_errors_per_min: float
    scoring_active: int
    # Pipeline error details (last 50, newest first) + cumulative totals since startup
    pipeline_errors: list[PipelineErrorOut]
    pipeline_error_totals: dict[str, int]
    # Persistently-errored articles (error_count > 0) — actionable in the admin
    errored_count: int
    errored_articles: list[ErroredArticleOut]
    # Rate history (up to 12 points × 30s = last 6 min) for sparklines
    rate_history: list[RatePoint]
    # Embeddings
    embeddings_done: int
    embeddings_total: int
    # ETA estimates (minutes)
    eta_embed_min: Optional[float]
    eta_enrich_min: Optional[float]
    eta_score_min: Optional[float]
    # Score distribution buckets
    score_distribution: dict[str, int]
    # Relevance
    relevance_distribution: dict[str, int]   # on_topic / borderline / off_topic / unclassified
    llm_calls_saved: int                     # articles stopped by the gate (status hors_sujet) × 3
    feedback_count: int
    ml_last_trained: Optional[datetime]
    ml_accuracy: Optional[float]
    # Idle re-review (quality assurance sweep of legacy articles)
    review_enabled: bool
    current_pipeline_version: int
    review_pending: int                      # scored articles still on an older pipeline version
    reviewed_count: int                      # articles re-reviewed at least once
    reviewed_per_min: float
    # Coverage (pct of scored articles)
    corroboration_coverage: float
    fact_check_coverage: float
    # Top 10 tags
    top_tags: list[TagCountOut]
    # Collection errors in last 24h
    error_count_24h: int
    # Error logs explicitly (separate from recent_logs window — ensures visibility)
    error_logs: list[LogAdminOut]
    # Per-source details
    sources: list[SourceAdminOut]
    recent_logs: list[LogAdminOut]


# ── Admin stats endpoint ──────────────────────────────────────────────────────

@router.get("/admin", response_model=AdminStatsOut)
def get_admin_stats(db: Session = Depends(get_db)):

    # ── Pipeline by status ───────────────────────────────────────────────
    status_rows = db.query(Article.status, func.count(Article.id)).group_by(Article.status).all()
    by_status: dict[str, int] = {r[0]: r[1] for r in status_rows}
    total = sum(by_status.values())
    n_enrichi = by_status.get("enrichi", 0)
    n_score   = by_status.get("score", 0)

    reliable = (
        db.query(func.count(Article.id))
        .filter(Article.confidence_score >= settings.reliability_threshold)
        .scalar() or 0
    )
    avg = db.query(func.avg(Article.confidence_score)).scalar()

    # ── Throughput / growth (single table scan) ───────────────────────────
    combined = db.execute(text("""
        SELECT
          SUM(CASE WHEN confidence_score < 20 THEN 1 ELSE 0 END),
          SUM(CASE WHEN confidence_score >= 20 AND confidence_score < 40 THEN 1 ELSE 0 END),
          SUM(CASE WHEN confidence_score >= 40 AND confidence_score < 60 THEN 1 ELSE 0 END),
          SUM(CASE WHEN confidence_score >= 60 AND confidence_score < 80 THEN 1 ELSE 0 END),
          SUM(CASE WHEN confidence_score >= 80 THEN 1 ELSE 0 END),
          SUM(CASE WHEN DATE(collected_at) = CURDATE() THEN 1 ELSE 0 END),
          SUM(CASE WHEN collected_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END)
        FROM articles
    """)).fetchone()

    score_distribution = {
        "0-20":   int(combined[0] or 0),
        "20-40":  int(combined[1] or 0),
        "40-60":  int(combined[2] or 0),
        "60-80":  int(combined[3] or 0),
        "80-100": int(combined[4] or 0),
    }
    articles_today = int(combined[5] or 0)
    articles_week  = int(combined[6] or 0)

    # ── Collection throughput (last hour) ────────────────────────────────
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    throughput = (
        db.query(func.sum(CollectLog.articles_fetched))
        .filter(CollectLog.collected_at >= one_hour_ago)
        .scalar() or 0
    )

    # ── Collection errors (last 24h) ─────────────────────────────────────
    day_ago = datetime.utcnow() - timedelta(hours=24)
    error_count_24h = (
        db.query(func.count(CollectLog.id))
        .filter(CollectLog.collected_at >= day_ago)
        .filter(CollectLog.errors.isnot(None))
        .scalar() or 0
    )

    # ── Coverage ─────────────────────────────────────────────────────────
    articles_with_corr = (
        db.query(func.count(distinct(Corroboration.article_id))).scalar() or 0
    )
    articles_with_fc = (
        db.query(func.count(distinct(FactCheck.article_id))).scalar() or 0
    )
    corr_coverage = round(articles_with_corr / n_score * 100, 1) if n_score else 0.0
    fc_coverage   = round(articles_with_fc   / n_score * 100, 1) if n_score else 0.0

    # ── Top tags (raw SQL — simpler than importing the association table) ──
    tag_rows = db.execute(text("""
        SELECT t.name, COUNT(art.article_id) AS cnt
        FROM tags t
        JOIN articles_tags art ON t.id = art.tag_id
        GROUP BY t.id, t.name
        ORDER BY cnt DESC
        LIMIT 10
    """)).fetchall()
    top_tags = [TagCountOut(name=r[0], count=int(r[1])) for r in tag_rows]

    # ── Per-source pipeline breakdown ────────────────────────────────────
    pipeline_rows = (
        db.query(Article.source_id, Article.status, func.count(Article.id))
        .group_by(Article.source_id, Article.status)
        .all()
    )
    source_pipeline: dict[int, dict[str, int]] = {}
    for source_id, status, count in pipeline_rows:
        if source_id not in source_pipeline:
            source_pipeline[source_id] = {}
        source_pipeline[source_id][status] = count

    source_counts = {sid: sum(s.values()) for sid, s in source_pipeline.items()}
    sources_out = [
        SourceAdminOut(
            id=s.id,
            name=s.name,
            feed_url=s.feed_url,
            type=s.type,
            reliability=s.reliability,
            active=s.active,
            last_collected=s.last_collected,
            article_count=source_counts.get(s.id, 0),
            pipeline=source_pipeline.get(s.id, {}),
        )
        for s in db.query(Source).order_by(Source.reliability.desc()).all()
    ]

    # ── Recent collection logs ────────────────────────────────────────────
    logs = (
        db.query(CollectLog, Source.name)
        .join(Source, Source.id == CollectLog.source_id)
        .order_by(CollectLog.collected_at.desc())
        .limit(30)
        .all()
    )
    logs_out = [
        LogAdminOut(
            id=log.id,
            source_name=name,
            collected_at=log.collected_at,
            articles_fetched=log.articles_fetched,
            errors=log.errors,
        )
        for log, name in logs
    ]

    # ── Error logs (dedicated — not limited to recent 30 window) ─────────
    error_rows = (
        db.query(CollectLog, Source.name)
        .join(Source, Source.id == CollectLog.source_id)
        .filter(CollectLog.collected_at >= day_ago)
        .filter(CollectLog.errors.isnot(None))
        .order_by(CollectLog.collected_at.desc())
        .limit(50)
        .all()
    )
    error_logs_out = [
        LogAdminOut(
            id=log.id,
            source_name=name,
            collected_at=log.collected_at,
            articles_fetched=log.articles_fetched,
            errors=log.errors,
        )
        for log, name in error_rows
    ]

    # ── Relevance ────────────────────────────────────────────────────────
    rel_rows = db.query(Article.relevance, func.count(Article.id)).group_by(Article.relevance).all()
    relevance_distribution = {"on_topic": 0, "borderline": 0, "off_topic": 0, "unclassified": 0}
    for rel, count in rel_rows:
        relevance_distribution[rel or "unclassified"] = count
    # Articles stopped at the gate never consume the 3 LLM calls
    # (1 enrichment + 2 fact-check) — that is the GPU budget saved.
    gate_stopped = by_status.get("hors_sujet", 0)
    from models import Feedback, MlModel
    feedback_count = db.query(func.count(Feedback.article_id)).scalar() or 0
    last_model = db.query(MlModel).order_by(MlModel.trained_at.desc()).first()

    # ── Idle re-review sweep ─────────────────────────────────────────────
    # Pending = scored articles still on an older pipeline version (the idle
    # reviewer re-enriches + re-scores them; this count drops to 0 as it sweeps).
    review_pending = (
        db.query(func.count(Article.id))
        .filter(Article.status == "score", Article.pipeline_version < CURRENT_PIPELINE_VERSION)
        .scalar() or 0
    )
    reviewed_count = (
        db.query(func.count(Article.id))
        .filter(Article.reviewed_at.isnot(None))
        .scalar() or 0
    )

    # ── Persistently-errored articles (parked after MAX_PIPELINE_ATTEMPTS) ──
    errored_count = (
        db.query(func.count(Article.id)).filter(Article.error_count > 0).scalar() or 0
    )
    errored_rows = (
        db.query(Article.id, Article.title, Article.status, Article.error_count, Article.last_error)
        .filter(Article.error_count > 0)
        .order_by(Article.error_count.desc(), Article.id.desc())
        .limit(50)
        .all()
    )
    errored_articles = [
        ErroredArticleOut(id=r[0], title=r[1], status=r[2], error_count=r[3], last_error=r[4])
        for r in errored_rows
    ]

    # ── Embeddings ───────────────────────────────────────────────────────
    embeddings_done = db.query(func.count(Embedding.article_id)).scalar() or 0

    # ── Live rates (pipeline_stats in-memory) ────────────────────────────
    from pipeline_stats import stats as _stats
    rates = _stats.snapshot()

    pending_enrich     = (
        by_status.get("collecte", 0)
        + by_status.get("pertinent", 0)
        + by_status.get("processing", 0)
    )
    pending_score      = pending_enrich + n_enrichi
    embeddings_missing = total - embeddings_done

    eta_embed  = round(embeddings_missing / rates["embedded_per_min"],  1) if rates["embedded_per_min"]  > 0 and embeddings_missing > 0 else None
    eta_enrich = round(pending_enrich     / rates["enriched_per_min"],  1) if rates["enriched_per_min"]  > 0 else None
    eta_score  = round(pending_score      / rates["scored_per_min"],    1) if rates["scored_per_min"]    > 0 else None

    return AdminStatsOut(
        pipeline={**by_status, "total": total},
        pct_enriched=round((n_enrichi + n_score) / total * 100, 1) if total else 0.0,
        pct_scored=round(n_score / total * 100, 1) if total else 0.0,
        reliable_count=reliable,
        pct_reliable=round(reliable / total * 100, 1) if total else 0.0,
        avg_score=round(float(avg), 1) if avg is not None else None,
        throughput_last_hour=int(throughput),
        articles_today=articles_today,
        articles_week=articles_week,
        enriched_per_min=rates["enriched_per_min"],
        scored_per_min=rates["scored_per_min"],
        embedded_per_min=rates["embedded_per_min"],
        gated_per_min=rates["gated_per_min"],
        enrich_errors_per_min=rates["enrich_errors_per_min"],
        score_errors_per_min=rates["score_errors_per_min"],
        scoring_active=rates["scoring_active"],
        pipeline_errors=[PipelineErrorOut(**e) for e in rates["recent_errors"]],
        pipeline_error_totals=rates["error_totals"],
        rate_history=[RatePoint(**h) for h in rates["history"]],
        embeddings_done=embeddings_done,
        embeddings_total=total,
        eta_embed_min=eta_embed,
        eta_enrich_min=eta_enrich,
        eta_score_min=eta_score,
        score_distribution=score_distribution,
        relevance_distribution=relevance_distribution,
        llm_calls_saved=gate_stopped * 3,
        feedback_count=feedback_count,
        ml_last_trained=last_model.trained_at if last_model else None,
        ml_accuracy=last_model.accuracy if last_model else None,
        review_enabled=settings.review_enabled,
        current_pipeline_version=CURRENT_PIPELINE_VERSION,
        review_pending=int(review_pending),
        reviewed_count=int(reviewed_count),
        reviewed_per_min=rates["reviewed_per_min"],
        errored_count=int(errored_count),
        errored_articles=errored_articles,
        corroboration_coverage=corr_coverage,
        fact_check_coverage=fc_coverage,
        top_tags=top_tags,
        error_count_24h=int(error_count_24h),
        error_logs=error_logs_out,
        sources=sources_out,
        recent_logs=logs_out,
    )


# ── DB stats (queried from information_schema — separate endpoint) ────────────

class TableStatOut(BaseModel):
    name: str
    rows: int
    data_mb: float
    index_mb: float


class DbStatsOut(BaseModel):
    tables: list[TableStatOut]
    total_data_mb: float
    total_index_mb: float


@router.get("/db", response_model=DbStatsOut)
def get_db_stats(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT
            TABLE_NAME,
            COALESCE(TABLE_ROWS, 0),
            ROUND(COALESCE(DATA_LENGTH,  0) / 1024 / 1024, 3),
            ROUND(COALESCE(INDEX_LENGTH, 0) / 1024 / 1024, 3)
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) DESC
    """)).fetchall()

    tables = [
        TableStatOut(name=r[0], rows=int(r[1]), data_mb=float(r[2]), index_mb=float(r[3]))
        for r in rows
    ]
    total_data  = round(sum(t.data_mb  for t in tables), 2)
    total_index = round(sum(t.index_mb for t in tables), 2)

    return DbStatsOut(tables=tables, total_data_mb=total_data, total_index_mb=total_index)
