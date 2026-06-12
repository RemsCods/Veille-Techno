from datetime import datetime
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, text
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Article, Corroboration, Feedback, Source, Tag
from schemas import ArticleOut, ArticleDetail, FeedbackCreate, ScoreBreakdownOut
from relevance import bucket_from_margin
from confidence import (
    score_source, score_freshness, score_recency, score_completeness,
    score_corroboration_from_stored, score_fact_check_from_stored,
)

router = APIRouter(prefix="/articles", tags=["articles"])


class PopularTagOut(BaseModel):
    name: str
    count: int


@router.get("", response_model=list[ArticleOut])
def list_articles(
    source: Optional[int] = None,
    min_score: Optional[float] = None,
    category: Optional[str] = None,
    tags: list[str] = Query(default=[]),   # multi-tag filter (OR semantics)
    from_date: Optional[datetime] = None,
    search: Optional[str] = None,
    deduplicate: bool = True,              # hide cluster duplicates by default
    relevance: Optional[Literal["on_topic", "borderline", "off_topic"]] = None,
    show_off_topic: bool = False,          # off-topic hidden by default (kept in DB)
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    sort_by: Literal[
        "collected_at", "confidence_score", "source_reliability", "corroborations",
        "relevance_score", "uncertainty",
    ] = "collected_at",
    sort_dir: Literal["asc", "desc"] = "desc",
    db: Session = Depends(get_db),
):
    q = db.query(Article)

    # Deduplication: only show canonical articles (canonical_id IS NULL)
    if deduplicate:
        q = q.filter(Article.canonical_id.is_(None))

    # Relevance: hide off_topic by default. NULL relevance (not yet gated)
    # stays visible — never silently drop unclassified articles.
    if relevance is not None:
        q = q.filter(Article.relevance == relevance)
    elif not show_off_topic:
        q = q.filter(or_(Article.relevance.is_(None), Article.relevance != "off_topic"))

    # Filters
    if source:
        q = q.filter(Article.source_id == source)
    if min_score is not None:
        q = q.filter(Article.confidence_score >= min_score)
    if from_date:
        q = q.filter(Article.published_at >= from_date)
    if category:
        q = q.filter(Article.tags.any(name=category))
    # Multi-tag filter (OR): article must have at least one of the selected tags
    if tags:
        from sqlalchemy import or_ as sql_or
        q = q.filter(sql_or(*[Article.tags.any(Tag.name == t) for t in tags]))
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                Article.title.ilike(pattern),
                Article.summary.ilike(pattern),
                Article.tags.any(Tag.name.ilike(pattern)),
            )
        )

    # Sorting — MariaDB doesn't support NULLS LAST/FIRST syntax.
    # Workaround: for nullable columns in ASC, prepend ISNULL(col) so NULLs
    # sort last (ISNULL returns 1 for NULL, 0 for non-NULL → ASC puts 0 first).
    # For DESC, MariaDB already puts NULLs last naturally (NULL < any value).
    secondary = Article.collected_at.desc()  # stable tiebreaker

    if sort_by == "source_reliability":
        q = q.join(Source, Article.source_id == Source.id)
        col = Source.reliability  # NOT NULL
        order = col.desc() if sort_dir == "desc" else col.asc()
        q = q.order_by(order, secondary)

    elif sort_by == "confidence_score":
        # Nullable — NULLs last in both directions
        col = Article.confidence_score
        if sort_dir == "desc":
            q = q.order_by(col.desc(), secondary)           # NULLs naturally last in MariaDB DESC
        else:
            q = q.order_by(func.isnull(col), col.asc(), secondary)  # explicit NULLs last for ASC

    elif sort_by == "corroborations":
        # Count corroborating articles per article — most confirmed news first
        corr_count = func.count(Corroboration.similar_article_id).label("corr_count")
        q = (
            q.outerjoin(Corroboration, Corroboration.article_id == Article.id)
             .group_by(Article.id)
             .order_by(corr_count.desc() if sort_dir == "desc" else corr_count.asc(), secondary)
        )

    elif sort_by == "relevance_score":
        col = Article.relevance_score
        if sort_dir == "desc":
            q = q.order_by(col.desc(), secondary)
        else:
            q = q.order_by(func.isnull(col), col.asc(), secondary)

    elif sort_by == "uncertainty":
        # Active-learning review queue: articles the classifier (or, before any
        # model exists, the anchor margin) is least sure about, unlabeled first.
        # 50 = neutral → sort by |score − 50| ascending.
        from models import Feedback as _Feedback
        q = (
            q.outerjoin(_Feedback, _Feedback.article_id == Article.id)
             .filter(_Feedback.article_id.is_(None))           # not yet labeled
             .order_by(
                 func.abs(func.coalesce(Article.ml_relevance, Article.relevance_score, 50) - 50).asc(),
                 secondary,
             )
        )

    else:  # collected_at — NOT NULL, default
        col = Article.collected_at
        order = col.desc() if sort_dir == "desc" else col.asc()
        q = q.order_by(order, secondary)

    return q.offset(offset).limit(limit).all()


@router.get("/tags/popular", response_model=list[PopularTagOut])
def popular_tags(limit: int = Query(default=30, le=100), db: Session = Depends(get_db)):
    """Top tags by article count — used by the Feed chip filter."""
    rows = db.execute(text("""
        SELECT t.name, COUNT(at.article_id) AS cnt
        FROM tags t
        JOIN articles_tags at ON at.tag_id = t.id
        GROUP BY t.id, t.name
        ORDER BY cnt DESC
        LIMIT :limit
    """), {"limit": limit}).fetchall()
    return [{"name": r[0], "count": r[1]} for r in rows]


@router.put("/{article_id}/feedback", response_model=ArticleOut)
def set_feedback(article_id: int, payload: FeedbackCreate, db: Session = Depends(get_db)):
    """
    Human relevance verdict (👍 pertinent / 👎 non pertinent).
    Takes effect immediately on the article's relevance bucket — the human
    always wins over the gate and the LLM. Also feeds the active-learning
    training set (workers/learner.py).
    """
    if payload.verdict not in ("pertinent", "non_pertinent"):
        raise HTTPException(422, "verdict must be 'pertinent' or 'non_pertinent'")
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(404, "Article not found")

    fb = db.get(Feedback, article_id)
    if fb:
        fb.verdict = payload.verdict
    else:
        db.add(Feedback(article_id=article_id, verdict=payload.verdict))

    if payload.verdict == "non_pertinent":
        article.relevance = "off_topic"
        article.relevance_reason = "feedback humain (👎 non pertinent)"
    else:
        article.relevance = "on_topic"
        article.relevance_reason = "feedback humain (👍 pertinent)"
    db.commit()
    db.refresh(article)
    return article


@router.delete("/{article_id}/feedback", response_model=ArticleOut)
def remove_feedback(article_id: int, db: Session = Depends(get_db)):
    """Undo a human verdict — the bucket is recomputed from the stored margin."""
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(404, "Article not found")
    fb = db.get(Feedback, article_id)
    if fb:
        db.delete(fb)
    if article.relevance_score is not None:
        margin = (article.relevance_score - 50) / 250
        article.relevance = bucket_from_margin(margin)
        article.relevance_reason = f"recalculé après retrait du feedback (marge {margin:+.2f})"
    else:
        article.relevance = None
        article.relevance_reason = None
    db.commit()
    db.refresh(article)
    return article


@router.get("/{article_id}", response_model=ArticleDetail)
def get_article(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    result = ArticleDetail.model_validate(article)
    if article.status == "score":
        result.score_breakdown = ScoreBreakdownOut(
            source=score_source(article),
            corroboration=score_corroboration_from_stored(article),
            fact_check=score_fact_check_from_stored(article),
            freshness=score_freshness(article),
            recency=score_recency(article),
            completeness=score_completeness(article),
        )
    return result
