from datetime import datetime
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Article, Corroboration, Source, Tag
from schemas import ArticleOut, ArticleDetail, ScoreBreakdownOut
from confidence import score_source, score_freshness, score_corroboration_from_stored, score_fact_check_from_stored

router = APIRouter(prefix="/articles", tags=["articles"])


@router.get("", response_model=list[ArticleOut])
def list_articles(
    source: Optional[int] = None,
    min_score: Optional[float] = None,
    category: Optional[str] = None,
    from_date: Optional[datetime] = None,
    search: Optional[str] = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    sort_by: Literal[
        "collected_at", "confidence_score", "source_reliability", "corroborations"
    ] = "collected_at",
    sort_dir: Literal["asc", "desc"] = "desc",
    db: Session = Depends(get_db),
):
    q = db.query(Article)

    # Filters
    if source:
        q = q.filter(Article.source_id == source)
    if min_score is not None:
        q = q.filter(Article.confidence_score >= min_score)
    if from_date:
        q = q.filter(Article.published_at >= from_date)
    if category:
        q = q.filter(Article.tags.any(name=category))
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

    else:  # collected_at — NOT NULL, default
        col = Article.collected_at
        order = col.desc() if sort_dir == "desc" else col.asc()
        q = q.order_by(order, secondary)

    return q.offset(offset).limit(limit).all()


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
        )
    return result
