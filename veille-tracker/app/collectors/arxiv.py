from datetime import datetime
import feedparser
from sqlalchemy.orm import Session
from models import Source, Article, CollectLog
from collectors.utils import ArticleBatchInserter


def collect_arxiv(source: Source, db: Session) -> int:
    feed = feedparser.parse(source.feed_url)
    inserter = ArticleBatchInserter(db)

    for entry in feed.entries:
        url   = getattr(entry, "link",  None)
        title = getattr(entry, "title", "")
        if not url:
            continue
        inserter.add(Article(
            source_id=source.id,
            url=url,
            title=title.replace("\n", " ").strip(),
            content=getattr(entry, "summary", None),
            author=", ".join(
                a.get("name", "") for a in getattr(entry, "authors", [])
            ) or None,
            published_at=None,
        ))

    inserter.finish()

    source.last_collected = datetime.utcnow()
    db.add(CollectLog(
        source_id=source.id,
        articles_fetched=inserter.count,
        errors=inserter.error_str,
    ))
    db.commit()
    return inserter.count
