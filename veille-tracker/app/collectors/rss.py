from datetime import datetime, timezone
from typing import Optional
import feedparser
from sqlalchemy.orm import Session
from models import Source, Article, Blacklist, CollectLog
from collectors.utils import ArticleBatchInserter


def _is_blacklisted(url: str, patterns: list[str]) -> bool:
    return any(p in url for p in patterns)


def _parse_date(entry) -> Optional[datetime]:
    for attr in ("published_parsed", "updated_parsed"):
        val = getattr(entry, attr, None)
        if val:
            try:
                return datetime(*val[:6], tzinfo=timezone.utc).replace(tzinfo=None)
            except Exception:
                pass
    return None


def collect_rss(source: Source, db: Session) -> int:
    blacklisted = [b.pattern for b in db.query(Blacklist).all()]
    feed = feedparser.parse(source.feed_url)
    inserter = ArticleBatchInserter(db)

    for entry in feed.entries:
        url   = getattr(entry, "link",  None)
        title = getattr(entry, "title", None)
        if not url or not title:
            continue
        if _is_blacklisted(url, blacklisted):
            continue
        content = (
            getattr(entry, "content", [{}])[0].get("value")
            or getattr(entry, "summary", None)
        )
        inserter.add(Article(
            source_id=source.id,
            url=url,
            title=title,
            content=content,
            author=getattr(entry, "author", None),
            published_at=_parse_date(entry),
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
