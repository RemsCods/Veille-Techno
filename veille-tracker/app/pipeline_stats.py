import threading
import time
from collections import deque


class PipelineStats:
    def __init__(self):
        self._lock = threading.Lock()
        self._enriched: deque[float] = deque()
        self._scored: deque[float] = deque()
        self._embedded: deque[float] = deque()
        self._enrich_errors: deque[float] = deque()
        self._score_errors: deque[float] = deque()
        self._scoring_active: int = 0
        # Rate history — one snapshot every 30s, keeps last 12 (= 6 min)
        self._history: deque = deque(maxlen=12)
        self._last_history_t: float = 0.0

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

    def record_enrich_error(self) -> None:
        now = time.monotonic()
        with self._lock:
            self._enrich_errors.append(now)

    def record_score_error(self) -> None:
        now = time.monotonic()
        with self._lock:
            self._score_errors.append(now)

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
        return rates


stats = PipelineStats()
