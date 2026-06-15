import threading
import time
from collections import deque
from datetime import datetime

from errors import classify_error


# Hard cap on each rate deque. The rate window is 60s, so legitimate counts are
# at most a few hundred per deque; this maxlen is a safety bound so the deques
# can never grow without limit (they are only time-trimmed when snapshot() runs,
# i.e. when the admin page polls — without it, a long continuous run with no
# admin open leaks memory unboundedly). 5000 ≫ any legitimate 60s count.
_RATE_MAXLEN = 5000


class PipelineStats:
    def __init__(self):
        self._lock = threading.Lock()
        self._enriched: deque[float] = deque(maxlen=_RATE_MAXLEN)
        self._scored: deque[float] = deque(maxlen=_RATE_MAXLEN)
        self._embedded: deque[float] = deque(maxlen=_RATE_MAXLEN)
        self._gated: deque[float] = deque(maxlen=_RATE_MAXLEN)
        self._reviewed: deque[float] = deque(maxlen=_RATE_MAXLEN)   # legacy articles re-injected by the idle reviewer
        self._enrich_errors: deque[float] = deque(maxlen=_RATE_MAXLEN)
        self._score_errors: deque[float] = deque(maxlen=_RATE_MAXLEN)
        self._scoring_active: int = 0
        # Rate history — one snapshot every 30s, keeps last 12 (= 6 min)
        self._history: deque = deque(maxlen=12)
        self._last_history_t: float = 0.0
        # Error detail buffer — the per-minute rates alone were useless for
        # debugging: a burst would show "err/min" for 60s then vanish with no
        # trace of WHAT failed. Keep the last 50 classified errors, cumulative
        # totals per stage, and an aggregate per CAUSE (the "biggest cause").
        self._error_log: deque = deque(maxlen=50)
        self._error_totals: dict[str, int] = {}
        self._error_by_category: dict[str, dict] = {}

    def record_enriched(self, n: int = 1) -> None:
        now = time.monotonic()
        with self._lock:
            for _ in range(n):
                self._enriched.append(now)

    def record_scored(self, n: int = 1) -> None:
        now = time.monotonic()
        with self._lock:
            for _ in range(n):
                self._scored.append(now)

    def record_embedded(self, n: int = 1) -> None:
        now = time.monotonic()
        with self._lock:
            for _ in range(n):
                self._embedded.append(now)

    def record_gated(self, n: int = 1) -> None:
        now = time.monotonic()
        with self._lock:
            for _ in range(n):
                self._gated.append(now)

    def record_reviewed(self, n: int = 1) -> None:
        now = time.monotonic()
        with self._lock:
            for _ in range(n):
                self._reviewed.append(now)

    def record_enrich_error(self, article_id: int | None = None, exc=None, context: str = "") -> None:
        now = time.monotonic()
        with self._lock:
            self._enrich_errors.append(now)
        self._log_error("enrich", article_id, exc, context)

    def record_score_error(self, article_id: int | None = None, exc=None, context: str = "") -> None:
        now = time.monotonic()
        with self._lock:
            self._score_errors.append(now)
        self._log_error("score", article_id, exc, context)

    def record_gate_error(self, article_id: int | None = None, exc=None, context: str = "") -> None:
        self._log_error("gate", article_id, exc, context)

    def _log_error(self, stage: str, article_id: int | None, exc, context: str = "") -> None:
        info = classify_error(exc, context)
        at = datetime.utcnow().isoformat()
        with self._lock:
            self._error_totals[stage] = self._error_totals.get(stage, 0) + 1
            cat = info["category"]
            bucket = self._error_by_category.get(cat)
            if bucket is None:
                self._error_by_category[cat] = {
                    "category":  cat,
                    "severity":  info["severity"],
                    "count":     1,
                    "last_seen": at,
                    "sample":    info["summary"],
                }
            else:
                bucket["count"]    += 1
                bucket["severity"]  = info["severity"]   # same category → stable severity
                bucket["last_seen"] = at
                bucket["sample"]    = info["summary"]
            self._error_log.append({
                "stage":      stage,
                "article_id": article_id,
                "category":   info["category"],
                "severity":   info["severity"],
                "summary":    info["summary"],
                "detail":     info["detail"],
                "at":         at,
            })

    def set_scoring_active(self, n: int) -> None:
        with self._lock:
            self._scoring_active = n

    def adjust_scoring_active(self, delta: int) -> None:
        with self._lock:
            self._scoring_active = max(0, self._scoring_active + delta)

    def _rate(self, q: deque, window: int = 60) -> float:
        now = time.monotonic()
        cutoff = now - window
        with self._lock:
            while q and q[0] < cutoff:
                q.popleft()
            return round(len(q) * 60 / window, 1)

    def snapshot(self) -> dict:
        now = time.monotonic()
        rates = {
            "enriched_per_min":      self._rate(self._enriched),
            "scored_per_min":        self._rate(self._scored),
            "embedded_per_min":      self._rate(self._embedded),
            "gated_per_min":         self._rate(self._gated),
            "reviewed_per_min":      self._rate(self._reviewed),
            "enrich_errors_per_min": self._rate(self._enrich_errors),
            "score_errors_per_min":  self._rate(self._score_errors),
        }
        with self._lock:
            rates["scoring_active"] = self._scoring_active
            # Push history snapshot at most once every 30s
            if now - self._last_history_t >= 30:
                self._history.append({
                    "enriched": rates["enriched_per_min"],
                    "scored":   rates["scored_per_min"],
                    "embedded": rates["embedded_per_min"],
                })
                self._last_history_t = now
            rates["history"] = list(self._history)
            rates["recent_errors"] = list(self._error_log)[::-1]  # newest first
            rates["error_totals"]  = dict(self._error_totals)
            # Aggregate by cause, biggest first — the "where do errors come from"
            rates["error_categories"] = sorted(
                (dict(c) for c in self._error_by_category.values()),
                key=lambda c: c["count"],
                reverse=True,
            )
        return rates


stats = PipelineStats()
