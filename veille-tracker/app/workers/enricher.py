import json
import re
import threading
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Article, Tag
from ollama_client import chat
from tag_normalizer import normalize_tag_list
from relevance import merge_relevance
from pipeline_stats import stats as _stats

# v2 prompt: same single LLM call now also returns a relevance verdict —
# the second relevance signal, at zero extra GPU cost.
SYSTEM_SUMMARISE = (
    "You are a technical assistant for a technology watch on artificial intelligence, "
    "machine learning and LLMs. Reply ONLY with JSON:\n"
    '{"summary": "...", "tags": ["tag1", ...], '
    '"relevance": "on_topic|borderline|off_topic", "relevance_reason": "..."}\n'
    "- summary: summarise the article in 3-4 sentences\n"
    "- tags: 3-5 relevant tags\n"
    "- relevance: is this article relevant to an AI/ML/LLM technology watch?\n"
    '  "on_topic" = clearly about AI/ML/LLM technology, research, products, tooling or policy\n'
    '  "borderline" = tangential (general tech or science with a partial AI angle)\n'
    '  "off_topic" = not about AI: spam, ads, casino/betting, crypto trading, sports, '
    "lifestyle, unrelated content\n"
    "- relevance_reason: one short sentence justifying the relevance verdict"
)

VALID_BUCKETS = ("on_topic", "borderline", "off_topic")

# Lock only for the atomic claim step (held for milliseconds, not during LLM calls)
_claim_lock = threading.Lock()


def enrich_article(article: Article, db: Session) -> None:
    text = (article.content or article.title)[:2000]

    llm_bucket = None
    llm_reason = None
    try:
        raw = chat(text, system=SYSTEM_SUMMARISE)
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group()) if match else {}
        article.summary = data.get("summary") or raw[:500]
        tag_names = data.get("tags", [])
        if data.get("relevance") in VALID_BUCKETS:
            llm_bucket = data["relevance"]
            llm_reason = str(data.get("relevance_reason") or "").strip()[:200]
    except Exception as exc:
        # Degraded fallback (raw excerpt as summary) — recorded so the admin
        # page shows WHY instead of a silent quality drop.
        article.summary = (article.content or "")[:300]
        tag_names = []
        _stats.record_enrich_error(article.id, f"LLM fallback: {type(exc).__name__}: {exc}")

    for name in normalize_tag_list(tag_names[:8]):   # normalize before storing
        tag = db.query(Tag).filter(Tag.name == name).first()
        if not tag:
            tag = Tag(name=name)
            db.add(tag)
            db.flush()
        if tag not in article.tags:
            article.tags.append(tag)

    # ── Merge relevance signals: embedding gate (already stored) + LLM ──
    embed_bucket = article.relevance
    final = merge_relevance(embed_bucket, llm_bucket)
    article.relevance = final
    if llm_reason:
        anchor_part = article.relevance_reason or ""
        joined = f"{anchor_part} · LLM : {llm_reason}" if anchor_part else f"LLM : {llm_reason}"
        article.relevance_reason = joined[:500]

    # off_topic confirmed by the LLM -> leaves the pipeline (never scored).
    # Kept in DB with its summary/tags for audit and possible re-inclusion.
    article.status = "hors_sujet" if final == "off_topic" else "enrichi"
    db.commit()


def run_enricher(batch: int = 25) -> int:
    """
    Claim a batch of articles atomically (pertinent → processing),
    then enrich each one. The claim step uses a threading lock held
    for milliseconds only — the slow LLM calls happen outside the lock.
    """
    # ── Step 1: claim articles atomically ──────────────────────────────
    db = SessionLocal()
    article_ids: list[int] = []
    try:
        with _claim_lock:
            rows = (
                db.query(Article.id)
                .filter(Article.status == "pertinent")
                .limit(batch)
                .all()
            )
            article_ids = [r[0] for r in rows]
            if article_ids:
                db.query(Article).filter(Article.id.in_(article_ids)).update(
                    {"status": "processing"}, synchronize_session=False
                )
                db.commit()
    except Exception:
        db.rollback()
        article_ids = []
    finally:
        db.close()

    if not article_ids:
        return 0

    # ── Step 2: enrich each claimed article (slow LLM calls, no lock) ──
    count = 0
    db = SessionLocal()
    try:
        for article_id in article_ids:
            article = db.get(Article, article_id)
            if not article:
                continue
            try:
                enrich_article(article, db)
                count += 1
                _stats.record_enriched()
            except Exception as exc:
                db.rollback()
                _stats.record_enrich_error(article_id, f"{type(exc).__name__}: {exc}")
                # On failure: revert to pertinent so it gets retried
                try:
                    a = db.get(Article, article_id)
                    if a and a.status == "processing":
                        a.status = "pertinent"
                        db.commit()
                except Exception:
                    db.rollback()
    finally:
        db.close()

    return count
