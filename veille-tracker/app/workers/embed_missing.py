from database import SessionLocal
from models import Article, Embedding
from ollama_client import embed, vector_to_bytes
from pipeline_stats import stats as _stats


def run_embed_missing(batch: int = 30) -> int:
    """Generate embeddings for enrichi/score articles that don't have one yet."""
    db = SessionLocal()
    count = 0
    try:
        existing_ids = db.query(Embedding.article_id).scalar_subquery()
        articles = (
            db.query(Article)
            .filter(Article.status.in_(["enrichi", "score"]))
            .filter(~Article.id.in_(existing_ids))
            .limit(batch)
            .all()
        )
        for article in articles:
            text = f"{article.title} {article.summary or ''}"
            try:
                vec = embed(text)
                db.merge(Embedding(
                    article_id=article.id,
                    vec_data=vector_to_bytes(vec),
                    model="nomic-embed-text",
                    dimensions=len(vec),
                ))
                db.commit()
                count += 1
                _stats.record_embedded()
            except Exception:
                db.rollback()
    finally:
        db.close()
    return count
