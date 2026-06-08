from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SourceBase(BaseModel):
    name: str
    feed_url: str
    type: str
    reliability: int = 50
    active: bool = True


class SourceCreate(SourceBase):
    pass


class SourcePatch(BaseModel):
    name: Optional[str] = None
    feed_url: Optional[str] = None
    type: Optional[str] = None
    reliability: Optional[int] = None
    active: Optional[bool] = None


class SourceOut(SourceBase):
    id: int
    last_collected: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TagOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class CorroborationOut(BaseModel):
    similar_article_id: int
    similarity_score: float

    model_config = {"from_attributes": True}


class FactCheckOut(BaseModel):
    id: int
    claim: str
    verifiable: Optional[bool]
    supporting_sources: Optional[str]

    model_config = {"from_attributes": True}


class ArticleOut(BaseModel):
    id: int
    source_id: int
    url: str
    title: str
    summary: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[datetime] = None
    collected_at: datetime
    confidence_score: Optional[float] = None
    status: str
    tags: list[TagOut] = []
    cluster_size: int = 1    # >1 means this article is a cluster canonical with duplicates

    model_config = {"from_attributes": True}


class ScoreBreakdownOut(BaseModel):
    source: float
    corroboration: float
    fact_check: float
    freshness: float


class ArticleDetail(ArticleOut):
    content: Optional[str] = None
    corroborations: list[CorroborationOut] = []
    fact_checks: list[FactCheckOut] = []
    score_breakdown: Optional[ScoreBreakdownOut] = None

    model_config = {"from_attributes": True}


class BlacklistCreate(BaseModel):
    pattern: str
    reason: Optional[str] = None


class BlacklistOut(BaseModel):
    id: int
    pattern: str
    reason: Optional[str]
    added_at: datetime

    model_config = {"from_attributes": True}


class StatsOut(BaseModel):
    total_articles: int
    reliable_articles: int
    pct_reliable: float
    avg_score: Optional[float]
    articles_by_status: dict[str, int]
