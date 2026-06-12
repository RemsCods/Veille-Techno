"""
Relevance assessment — is an article inside the watch scope?

Confidence (confidence.py) answers "can we trust this article?".
This module answers the orthogonal question "is it in our watch scope?".

Two independent signals:
1. Contrastive embedding gate (here): the article embedding is compared to
   POSITIVE anchors (what the watch is about) and NEGATIVE anchors (observed
   junk categories: account selling, casino, lifestyle…). The signal is the
   MARGIN  max_cos(positive) − max_cos(negative).
   Calibration on the real corpus (scripts/calibrate_v2_contrastive.py)
   showed that an absolute cosine threshold does not work — nomic's cosine
   space is compressed (0.39–0.82) and spam sits mid-distribution — while the
   contrastive margin cleanly isolates it (all known spam < −0.12).
   Deterministic, no LLM, explainable. Runs BEFORE enrichment so clear junk
   never consumes the 3 LLM calls (1 enrich + 2 fact-check).
2. LLM opinion (enricher prompt, zero extra cost): on_topic | borderline |
   off_topic + a one-sentence reason, for everything the gate lets through.

merge_relevance() combines both into the final articles.relevance bucket.
"""

import threading
import time
import numpy as np
from sqlalchemy.orm import Session
from config import settings
from models import TopicAnchor
from ollama_client import embed

# Anchor list refreshed from DB every 5 min (picks up admin edits).
# Embeddings are memoized per phrase for the process lifetime — an anchor
# phrase never changes meaning, so it is embedded exactly once.
_anchor_cache: dict = {"positive": [], "negative": []}   # polarity -> [(phrase, unit_vec)]
_anchor_lock = threading.Lock()
_anchor_ts: float = 0.0
_ANCHOR_TTL = 300.0
_phrase_vecs: dict = {}           # phrase -> unit numpy vector


def invalidate_anchor_cache() -> None:
    """Called by the anchors API after create/update/delete."""
    global _anchor_ts
    _anchor_ts = 0.0


def _get_anchors(db: Session) -> dict:
    global _anchor_cache, _anchor_ts
    if time.monotonic() - _anchor_ts < _ANCHOR_TTL and _anchor_cache["positive"]:
        return _anchor_cache
    with _anchor_lock:
        if time.monotonic() - _anchor_ts < _ANCHOR_TTL and _anchor_cache["positive"]:
            return _anchor_cache
        rows = db.query(TopicAnchor).filter(TopicAnchor.active == True).all()
        cache = {"positive": [], "negative": []}
        for a in rows:
            if a.phrase not in _phrase_vecs:
                vec = np.array(embed(a.phrase), dtype=np.float32)
                norm = np.linalg.norm(vec)
                _phrase_vecs[a.phrase] = vec / norm if norm > 0 else vec
            cache[a.polarity].append((a.phrase, _phrase_vecs[a.phrase]))
        _anchor_cache = cache
        _anchor_ts = time.monotonic()
    return _anchor_cache


def compute_relevance(vec: np.ndarray, db: Session):
    """
    Score an article embedding against the watch scope.

    Returns (margin, display_score, closest_positive_anchor):
    - margin: max_cos(positive) − max_cos(negative), the decision signal
      (negative anchors absent → margin = max_cos(positive) − 0.5, degraded)
    - display_score: margin remapped to 0–100 for the UI (50 = neutral)
    Returns (None, None, None) when no positive anchors exist (gate disabled).
    """
    anchors = _get_anchors(db)
    if not anchors["positive"]:
        return None, None, None

    norm = np.linalg.norm(vec)
    v = vec / norm if norm > 0 else vec

    best_pos, best_phrase = max(
        (float(np.dot(v, avec)), phrase) for phrase, avec in anchors["positive"]
    )
    if anchors["negative"]:
        best_neg = max(float(np.dot(v, avec)) for _, avec in anchors["negative"])
    else:
        best_neg = 0.5  # neutral fallback — margin becomes a soft absolute score

    margin = best_pos - best_neg
    display = round(min(max(50 + margin * 250, 0.0), 100.0), 1)
    return margin, display, best_phrase


def bucket_from_margin(margin: float) -> str:
    """Map a contrastive margin to a relevance bucket (thresholds in config)."""
    if margin < settings.relevance_t_low:
        return "off_topic"
    if margin < settings.relevance_t_high:
        return "borderline"
    return "on_topic"


def merge_relevance(embed_bucket, llm_bucket) -> str:
    """
    Combine the two signals into the final bucket.

    The gate already filtered clear off_topic before enrichment, so the
    embedding bucket here is on_topic/borderline (or None for legacy rows).
    - LLM missing/unparseable -> trust the embedding (default borderline)
    - LLM on_topic/borderline -> trust the LLM (it read the actual text)
    - LLM off_topic           -> 'borderline' if the embedding strongly
      disagreed (said on_topic), else off_topic. Disagreement = show the
      article but flag it, never silently drop it (veille principle:
      a false negative costs more than a false positive).
    """
    if llm_bucket not in ("on_topic", "borderline", "off_topic"):
        return embed_bucket or "borderline"
    if llm_bucket == "off_topic" and embed_bucket == "on_topic":
        return "borderline"
    return llm_bucket
