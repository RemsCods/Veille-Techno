import re
from datetime import datetime
from urllib.parse import urlparse, parse_qs
import httpx
from sqlalchemy.orm import Session
from models import Source, Article, CollectLog
from collectors.utils import ArticleBatchInserter

HN_SEARCH_BASE = "https://hn.algolia.com/api/v1/search_by_date"

# Used only for the generic (no custom query) source to avoid noise
AI_KEYWORDS = [
    "llm", "gpt", "claude", "gemini", "mistral", "transformer",
    "machine learning", "deep learning", "neural", "openai",
    "anthropic", "hugging face", "ollama", "diffusion", "embedding",
]

# Word-boundary matching — substring matching gave false positives:
# "gpt" matched "Egypt", "llm" matched "Wellman".
_KEYWORD_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in AI_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


def collect_hackernews(source: Source, db: Session) -> int:
    """
    Collect HN stories via Algolia.

    URL params are read from source.feed_url so each source can target
    a specific query:

      Generic:  https://hn.algolia.com/api/v1/search_by_date
                → query "LLM AI machine learning" + keyword filter

      Targeted: https://hn.algolia.com/api/v1/search_by_date?tags=story&query=anthropic
                → query "anthropic", no keyword filter (already specific)
    """
    # ── Parse URL parameters from feed_url ───────────────────────────────
    parsed = urlparse(source.feed_url)
    url_params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    has_custom_query = "query" in url_params

    params: dict = {
        "tags":        url_params.get("tags",        "story"),
        "query":       url_params.get("query",       "LLM AI machine learning"),
        "hitsPerPage": int(url_params.get("hitsPerPage", 50)),
    }
    if "numericFilters" in url_params:
        params["numericFilters"] = url_params["numericFilters"]

    # ── Fetch ─────────────────────────────────────────────────────────────
    fetch_errors: list[str] = []
    try:
        resp = httpx.get(HN_SEARCH_BASE, params=params, timeout=15)
        resp.raise_for_status()
        hits = resp.json().get("hits", [])
    except Exception as exc:
        fetch_errors.append(str(exc))
        hits = []

    # ── Insert ────────────────────────────────────────────────────────────
    inserter = ArticleBatchInserter(db)

    for hit in hits:
        url = (
            hit.get("url")
            or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        )
        title = hit.get("title", "")
        if not title:
            continue
        if not has_custom_query:
            if not _KEYWORD_RE.search(title):
                continue

        ts = hit.get("created_at_i")
        inserter.add(Article(
            source_id=source.id,
            url=url,
            title=title,
            author=hit.get("author"),
            published_at=datetime.utcfromtimestamp(ts) if ts else None,
        ))

    inserter.finish()

    all_errors = fetch_errors + inserter.errors
    source.last_collected = datetime.utcnow()
    db.add(CollectLog(
        source_id=source.id,
        articles_fetched=inserter.count,
        errors="; ".join(all_errors) if all_errors else None,
    ))
    db.commit()
    return inserter.count
