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


class FeedbackOut(BaseModel):
    verdict: str    # pertinent | non_pertinent

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
    previous_confidence_score: Optional[float] = None  # score before the last re-review (old→new)
    relevance: Optional[str] = None          # on_topic | borderline | off_topic
    relevance_score: Optional[float] = None  # 0-100, 50 = neutral margin
    relevance_reason: Optional[str] = None
    ml_relevance: Optional[float] = None     # learned classifier probability, 0-100
    feedback: Optional[FeedbackOut] = None   # human 👍/👎 verdict
    status: str
    pipeline_version: int = 1                # version that last fully processed this article
    reviewed_at: Optional[datetime] = None   # last idle re-review pass (None = never reviewed)
    tags: list[TagOut] = []
    cluster_size: int = 1    # >1 means this article is a cluster canonical with duplicates

    model_config = {"from_attributes": True}


class ScoreBreakdownOut(BaseModel):
    source: float
    corroboration: float
    fact_check: float
    freshness: float        # average of recency + completeness
    recency: float          # publication date freshness
    completeness: float     # author + content length


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


# ── Relevance / feedback / anchors ────────────────────────────────────────────

class FeedbackCreate(BaseModel):
    verdict: str    # pertinent | non_pertinent


class AnchorCreate(BaseModel):
    phrase: str
    polarity: str = "positive"   # positive | negative


class AnchorPatch(BaseModel):
    phrase: Optional[str] = None
    polarity: Optional[str] = None
    active: Optional[bool] = None


class AnchorOut(BaseModel):
    id: int
    phrase: str
    polarity: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MlModelOut(BaseModel):
    trained_at: Optional[datetime] = None
    n_samples: int = 0
    n_positive: int = 0
    accuracy: Optional[float] = None
    feedback_count: int = 0          # current labels available
    feedback_positive: int = 0
    min_per_class: int = 10
    trainable: bool = False
