import json
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Optional
import numpy as np
from sqlalchemy.orm import Session
from config import settings
from models import Article, Embedding, Corroboration, FactCheck
from ollama_client import chat, chat_with_model, bytes_to_vector

# ── In-memory embedding cache ─────────────────────────────────────────────────
# Shared across all scorer threads. Refreshed every 30 s.
# Format: list of (article_id, source_id, collected_at, vec_float32)
_vec_cache: list = []
_vec_cache_lock = threading.Lock()
_vec_cache_ts: float = 0.0
_VEC_CACHE_TTL = 30.0  # seconds


def _get_vec_cache(db: Session) -> list:
    """Return the embedding cache, refreshing from DB at most every 30 s."""
    global _vec_cache, _vec_cache_ts
    if time.monotonic() - _vec_cache_ts < _VEC_CACHE_TTL:
        return _vec_cache
    with _vec_cache_lock:
        # Double-checked locking: another thread may have refreshed while we waited
        if time.monotonic() - _vec_cache_ts < _VEC_CACHE_TTL:
            return _vec_cache
        rows = (
            db.query(
                Embedding.article_id,
                Article.source_id,
                Article.collected_at,
                Embedding.vec_data,
            )
            .join(Article, Article.id == Embedding.article_id)
            .all()
        )
        _vec_cache = [
            (r.article_id, r.source_id, r.collected_at,
             np.array(bytes_to_vector(r.vec_data), dtype=np.float32))
            for r in rows
        ]
        _vec_cache_ts = time.monotonic()
    return _vec_cache


def score_source(article: Article) -> float:
    return float(article.source.reliability)


def score_corroboration(article: Article, db: Session) -> float:
    if not article.embedding:
        return 30.0  # no embedding yet → neutral, not penalized

    vec_a = np.array(bytes_to_vector(article.embedding.vec_data), dtype=np.float32)
    window = datetime.utcnow() - timedelta(hours=settings.corroboration_window_hours)

    # Use in-memory cache — no DB roundtrip per article
    cache = _get_vec_cache(db)
    candidates = [
        (art_id, vec)
        for art_id, source_id, collected_at, vec in cache
        if art_id != article.id
        and source_id != article.source_id
        and (collected_at is None or collected_at >= window)
    ]

    if not candidates:
        return 30.0

    # Vectorized batch cosine similarity (one matrix multiply, not N loops)
    art_ids = [c[0] for c in candidates]
    matrix = np.stack([c[1] for c in candidates])        # (N, 768)
    norm_a = np.linalg.norm(vec_a)
    norms_b = np.linalg.norm(matrix, axis=1)             # (N,)
    denom = norms_b * norm_a
    sims = np.where(denom > 0, (matrix @ vec_a) / denom, 0.0)  # (N,)

    similar_ids = [
        (art_ids[i], float(sims[i]))
        for i in range(len(art_ids))
        if sims[i] >= settings.corroboration_cosine_threshold
    ]

    for art_id, sim in similar_ids:
        existing = db.get(Corroboration, (article.id, art_id))
        if not existing:
            db.add(Corroboration(
                article_id=article.id,
                similar_article_id=art_id,
                similarity_score=sim,
            ))
    db.commit()

    n = len(similar_ids)
    if n == 0: return 30.0
    if n == 1: return 55.0
    if n == 2: return 75.0
    if n == 3: return 90.0
    return 100.0


_FACTCHECK_PROMPT_TEMPLATE = (
    "Analyze this article and extract 3-5 key factual claims. "
    "Classify each as:\n"
    "- 'supported': stated fact with explicit attribution, or widely established knowledge\n"
    "- 'unsupported': assertion made without evidence or attribution\n"
    "- 'unverifiable': opinion, prediction, or speculation\n"
    "Return ONLY valid JSON: "
    '{"claims": [{"text": "...", "status": "supported|unsupported|unverifiable"}]}\n\n'
    "Title: {title}\nContent: {text}"
)


def _run_factcheck_model(title: str, text: str, model: str) -> list[dict]:
    """
    Ask one model to extract and classify factual claims.
    Returns list of {text, status} dicts, or [] on failure.
    """
    prompt = _FACTCHECK_PROMPT_TEMPLATE.format(title=title, text=text)
    try:
        raw = chat_with_model(prompt, model)
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group()) if match else {}
        return data.get("claims", [])
    except Exception:
        return []


def _merge_factcheck_claims(
    claims_a: list[dict], model_a: str,
    claims_b: list[dict], model_b: str,
) -> list[dict]:
    """
    Merge results from two models.

    Consensus rules (per claim, matched by index):
    - Both agree → use that status (high confidence)
    - One says 'supported', other says 'unsupported' → 'contested' (sharp disagreement)
    - One says 'unverifiable', other says anything → 'unverifiable' (conservative)
    - Only one model returned results → use its result with no secondary_status

    Returns list of {text, status, secondary_status, models} dicts.
    """
    model_label = f"{model_a}|{model_b}"

    if not claims_a and not claims_b:
        return []

    # Only one model worked
    if not claims_b:
        return [
            {"text": c.get("text", ""), "status": c.get("status", "unverifiable"),
             "secondary_status": None, "models": model_a}
            for c in claims_a
        ]
    if not claims_a:
        return [
            {"text": c.get("text", ""), "status": c.get("status", "unverifiable"),
             "secondary_status": None, "models": model_b}
            for c in claims_b
        ]

    # Both models returned results — merge by index (best we can do without semantic matching)
    merged = []
    for i, ca in enumerate(claims_a):
        status_a = ca.get("status", "unverifiable")
        cb = claims_b[i] if i < len(claims_b) else None
        status_b = cb.get("status") if cb else None

        if status_b is None:
            consensus = status_a
            secondary = None
        elif status_a == status_b:
            consensus = status_a
            secondary = status_b
        elif {"supported", "unsupported"} == {status_a, status_b}:
            # Sharp disagreement: one says supported, other says unsupported
            consensus = "contested"
            secondary = status_b
        else:
            # Mixed with unverifiable → conservative
            consensus = "unverifiable"
            secondary = status_b

        merged.append({
            "text":             ca.get("text", ""),
            "status":           consensus,
            "secondary_status": secondary,
            "models":           model_label,
        })
    return merged


def score_fact_check(article: Article, db: Session) -> float:
    """
    Dual-model fact-checking: runs qwen3.5 + gemma4:e4b in sequence.

    Scoring:
    - 'supported' (consensus)  → full credit
    - 'contested' (disagreement) → half credit (one model said supported)
    - 'unsupported'             → no credit
    - 'unverifiable'            → excluded from verifiable pool

    Falls back gracefully if either model is unavailable.
    """
    # Idempotent: clean up previous run before inserting fresh results
    db.query(FactCheck).filter(FactCheck.article_id == article.id).delete()

    text = (article.content or article.summary or "")[:2000]
    if not text.strip():
        return 60.0

    model_a = settings.ollama_chat_model       # qwen3.5:9b
    model_b = settings.ollama_factcheck_model  # gemma4:e4b

    claims_a = _run_factcheck_model(article.title, text, model_a)
    claims_b = _run_factcheck_model(article.title, text, model_b)

    merged = _merge_factcheck_claims(claims_a, model_a, claims_b, model_b)

    for c in merged:
        db.add(FactCheck(
            article_id=article.id,
            claim=c["text"],
            verifiable=c["status"] != "unverifiable",
            supporting_sources=c["status"],
            fact_check_models=c["models"],
            secondary_status=c["secondary_status"],
        ))
    db.commit()

    if not merged:
        return 60.0

    verifiable = [c for c in merged if c["status"] != "unverifiable"]
    if not verifiable:
        return 65.0

    # Scoring with partial credit for contested claims
    supported  = sum(1 for c in verifiable if c["status"] == "supported")
    contested  = sum(1 for c in verifiable if c["status"] == "contested")
    effective  = supported + contested * 0.5   # half credit when models disagree
    return max(round(effective / len(verifiable) * 100, 1), 35.0)


def score_freshness(article: Article) -> float:
    score = 0.0
    if article.published_at:
        age = (datetime.utcnow() - article.published_at).total_seconds() / 3600
        if age < 24:
            score += 40
        elif age < 72:
            score += 25
        elif age < 168:
            score += 10
    if article.author:
        score += 20
    content_len = len(article.content or article.summary or "")
    if content_len > 500:
        score += 25
    elif content_len > 100:
        score += 10
    return min(score, 100.0)


def score_corroboration_from_stored(article: Article) -> float:
    """Reconstruct corroboration score from already-stored Corroboration rows (no DB query)."""
    n = len(article.corroborations_as_main)
    if n == 0: return 30.0
    if n == 1: return 55.0
    if n == 2: return 75.0
    if n == 3: return 90.0
    return 100.0


def score_fact_check_from_stored(article: Article) -> float:
    """Reconstruct fact-check score from already-stored FactCheck rows (no LLM call)."""
    if not article.fact_checks:
        return 60.0
    verifiable = [fc for fc in article.fact_checks if fc.supporting_sources != "unverifiable"]
    if not verifiable:
        return 65.0
    supported = sum(1 for fc in verifiable if fc.supporting_sources == "supported")
    return max(round(supported / len(verifiable) * 100, 1), 35.0)


def compute_confidence(article: Article, db: Session) -> float:
    s_source = score_source(article)
    s_corr   = score_corroboration(article, db)
    s_fact   = score_fact_check(article, db)
    s_fresh  = score_freshness(article)

    total = (
        0.40 * s_source
        + 0.30 * s_corr
        + 0.20 * s_fact
        + 0.10 * s_fresh
    )
    return round(total, 1)
