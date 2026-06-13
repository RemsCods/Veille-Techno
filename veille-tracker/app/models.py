from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey,
    Integer, LargeBinary, String, Text
)
from sqlalchemy.orm import relationship
from database import Base


class Source(Base):
    __tablename__ = "sources"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    name           = Column(String(200), nullable=False)
    feed_url       = Column(String(500), nullable=False)
    type           = Column(Enum("rss", "api"), nullable=False)
    reliability    = Column(Integer, nullable=False, default=50)
    active         = Column(Boolean, nullable=False, default=True)
    last_collected = Column(DateTime)

    articles = relationship("Article", back_populates="source")
    logs     = relationship("CollectLog", back_populates="source")


class Blacklist(Base):
    __tablename__ = "blacklist"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    pattern  = Column(String(300), nullable=False)
    reason   = Column(Text)
    added_at = Column(DateTime, nullable=False, default=datetime.utcnow)


article_tags = __import__("sqlalchemy", fromlist=["Table"]).Table(
    "articles_tags",
    Base.metadata,
    Column("article_id", Integer, ForeignKey("articles.id"), primary_key=True),
    Column("tag_id",     Integer, ForeignKey("tags.id"),     primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    name     = Column(String(100), nullable=False, unique=True)

    articles = relationship("Article", secondary="articles_tags", back_populates="tags")


class Article(Base):
    __tablename__ = "articles"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    source_id        = Column(Integer, ForeignKey("sources.id"), nullable=False)
    url              = Column(String(1000), nullable=False, unique=True)
    title            = Column(Text, nullable=False)
    content          = Column(Text(4294967295))
    summary          = Column(Text)
    author           = Column(Text)
    published_at     = Column(DateTime)
    collected_at     = Column(DateTime, nullable=False, default=datetime.utcnow)
    confidence_score = Column(Float)
    previous_confidence_score = Column(Float)   # score before the last re-review (old→new display)
    # Relevance = in the watch scope or not (independent axis from confidence)
    relevance        = Column(Enum("on_topic", "borderline", "off_topic"))
    relevance_score  = Column(Float)                # embedding vs anchors, 0-100
    relevance_reason = Column(String(500))          # closest anchor / LLM reason / human feedback
    ml_relevance     = Column(Float)                # learned classifier probability, 0-100
    status           = Column(
        Enum("collecte", "processing", "pertinent", "enrichi", "score", "hors_sujet"),
        nullable=False,
        default="collecte",
    )
    # Version of the enrich/score pipeline that last fully processed this article.
    # The idle reviewer re-sweeps articles with pipeline_version < CURRENT_PIPELINE_VERSION.
    pipeline_version = Column(Integer, nullable=False, default=1)
    reviewed_at      = Column(DateTime)         # last re-review pass (NULL = never reviewed)
    error_count      = Column(Integer, nullable=False, default=0)  # parked at MAX_PIPELINE_ATTEMPTS
    last_error       = Column(String(500))      # last failure message (for the admin)
    # Semantic deduplication — NULL = canonical (or not yet clustered)
    canonical_id     = Column(Integer, ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    cluster_size     = Column(Integer, nullable=False, default=1)

    source       = relationship("Source", back_populates="articles")
    tags         = relationship("Tag", secondary="articles_tags", back_populates="articles")
    embedding    = relationship("Embedding", back_populates="article", uselist=False)
    fact_checks  = relationship("FactCheck", back_populates="article")
    feedback     = relationship("Feedback", back_populates="article", uselist=False)
    corroborations_as_main = relationship(
        "Corroboration",
        foreign_keys="Corroboration.article_id",
        back_populates="article",
    )


class Embedding(Base):
    __tablename__ = "embeddings"

    article_id = Column(Integer, ForeignKey("articles.id"), primary_key=True)
    vec_data   = Column(LargeBinary, nullable=False)
    model      = Column(String(100), nullable=False)
    dimensions = Column(Integer, nullable=False)

    article = relationship("Article", back_populates="embedding")


class Corroboration(Base):
    __tablename__ = "corroborations"

    article_id         = Column(Integer, ForeignKey("articles.id"), primary_key=True)
    similar_article_id = Column(Integer, ForeignKey("articles.id"), primary_key=True)
    similarity_score   = Column(Float, nullable=False)

    article = relationship("Article", foreign_keys=[article_id], back_populates="corroborations_as_main")


class FactCheck(Base):
    __tablename__ = "fact_checks"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    article_id         = Column(Integer, ForeignKey("articles.id"), nullable=False)
    claim              = Column(Text, nullable=False)
    verifiable         = Column(Boolean)
    supporting_sources = Column(Text)     # consensus status: supported|unsupported|unverifiable|contested
    fact_check_models  = Column(String(200))  # e.g. "qwen3.5:9b|gemma4:e4b"
    secondary_status   = Column(String(20))   # raw verdict from model B (for transparency)

    article = relationship("Article", back_populates="fact_checks")


class TopicAnchor(Base):
    __tablename__ = "topic_anchors"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    phrase     = Column(String(300), nullable=False, unique=True)
    # positive = what the watch IS about · negative = observed junk categories
    # (relevance = contrastive margin between the two — see relevance.py)
    polarity   = Column(Enum("positive", "negative"), nullable=False, default="positive")
    active     = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Feedback(Base):
    __tablename__ = "feedback"

    article_id = Column(Integer, ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    verdict    = Column(Enum("pertinent", "non_pertinent"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    article = relationship("Article", back_populates="feedback")


class MlModel(Base):
    __tablename__ = "ml_models"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    trained_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    n_samples  = Column(Integer, nullable=False)
    n_positive = Column(Integer, nullable=False)
    accuracy   = Column(Float)
    weights    = Column(LargeBinary, nullable=False)  # 768 float32 coefs + 1 bias


class CollectLog(Base):
    __tablename__ = "collect_logs"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    source_id        = Column(Integer, ForeignKey("sources.id"), nullable=False)
    collected_at     = Column(DateTime, nullable=False, default=datetime.utcnow)
    articles_fetched = Column(Integer, nullable=False, default=0)
    errors           = Column(Text)

    source = relationship("Source", back_populates="logs")
