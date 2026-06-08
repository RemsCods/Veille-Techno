"""
Shared insert utility for all collectors.

Usage:
    inserter = ArticleBatchInserter(db)
    for item in items:
        article = Article(source_id=..., url=..., title=..., ...)
        inserter.add(article)
    inserter.finish()

    log = CollectLog(articles_fetched=inserter.count,
                     errors=inserter.error_str)

Why this exists
---------------
MariaDB raises IntegrityError (1062) if a bulk INSERT contains a URL that
already exists (UNIQUE constraint on articles.url).  Committing one large
batch therefore fails completely even when only one row is a duplicate.

This class fixes the problem in one place so individual collectors don't
have to re-implement the pattern:

  1. intra-batch dedup via seen_urls set
  2. DB lookup to skip already-stored URLs
  3. commit every BATCH_SIZE rows — limits the blast radius of any failure
  4. on failure: rollback that mini-batch, record error, continue
"""

from sqlalchemy.orm import Session
from models import Article

DEFAULT_BATCH = 50


class ArticleBatchInserter:
    """Safe, batched article inserter shared by all collectors."""

    def __init__(self, db: Session, batch_size: int = DEFAULT_BATCH):
        self._db = db
        self._batch_size = batch_size
        self._seen: set[str] = set()   # intra-batch dedup
        self._pending: int = 0
        self.count: int = 0            # successfully committed articles
        self.errors: list[str] = []

    # ── Public API ────────────────────────────────────────────────────────

    def add(self, article: Article) -> bool:
        """
        Queue article for insertion if its URL is new.
        Auto-commits when the internal batch is full.
        Returns True if the article was queued.
        """
        url = article.url
        if not url:
            return False
        if url in self._seen:
            return False
        if self._db.query(Article).filter(Article.url == url).first():
            return False

        self._db.add(article)
        self._seen.add(url)
        self._pending += 1

        if self._pending >= self._batch_size:
            self._flush()

        return True

    def finish(self) -> None:
        """Flush any remaining pending articles."""
        self._flush()

    @property
    def error_str(self) -> str | None:
        """Returns errors joined as a string, or None if no errors."""
        return "; ".join(self.errors) if self.errors else None

    # ── Internal ──────────────────────────────────────────────────────────

    def _flush(self) -> None:
        if self._pending == 0:
            return
        try:
            self._db.commit()
            self.count += self._pending
        except Exception as exc:
            self._db.rollback()
            self.errors.append(str(exc))
        finally:
            self._pending = 0
