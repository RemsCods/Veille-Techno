from pydantic_settings import BaseSettings


# Version of the enrich/score pipeline. Bump this whenever the enrich/score
# logic changes meaningfully → the idle reviewer (workers/reviewer.py) then
# re-sweeps the whole corpus up to the new version. Articles last processed by
# an older version (pipeline_version < this) are eligible for re-review.
# Legacy rows (migration 003) carry version 1.
CURRENT_PIPELINE_VERSION = 2

# After this many consecutive failures at a pipeline stage, an article is parked
# (error_count >= this) and no longer auto-claimed by the workers — this stops a
# "poison" article from being retried every cycle forever (a tight retry loop
# wastes CPU/LLM calls and, via the stats counters, memory). Parked articles are
# surfaced in the admin for manual re-run or deletion.
MAX_PIPELINE_ATTEMPTS = 3


class Settings(BaseSettings):
    db_host: str = "db"
    db_port: int = 3306
    db_name: str = "veille"
    db_user: str = "veille"
    db_password: str = "changeme"

    ollama_host: str = "http://localhost:11434"
    ollama_chat_model: str = "qwen3.5:9b"
    ollama_factcheck_model: str = "llama3.2:3b"   # second model for dual fact-check (must fit in remaining VRAM alongside chat_model)
    ollama_embed_model: str = "nomic-embed-text"

    rss_collect_interval: str = "*/30 * * * *"
    arxiv_collect_interval: str = "0 */2 * * *"

    corroboration_window_hours: int = 72
    # Calibrated for nomic-embed-text's COMPRESSED cosine space (measured 2026-06-14):
    # same-story article pairs sit at ~0.70–0.85 (median 0.69, max 0.85), while random
    # different-topic AI pairs stay below ~0.72 (p99). 0.85 was above the real max of
    # near-duplicates → corroboration never fired. 0.78 separates same-story from same-topic
    # without over-clustering (calibrated on the live corpus: ~36% reliable, clean 3-tier spread).
    corroboration_cosine_threshold: float = 0.78
    # Clustering (feed dedup) is STRICTER than corroboration scoring: at 0.78 the
    # transitive closure chained same-topic/same-style articles into mega-clusters
    # (a 360-article OpenAI blob). Fuse only near-duplicates so the feed stays intact;
    # corroboration scoring still uses the looser 0.78 above.
    cluster_cosine_threshold: float = 0.88
    reliability_threshold: int = 70

    # Relevance gate thresholds on the CONTRASTIVE MARGIN
    # margin = max_cos(positive anchors) - max_cos(negative anchors).
    # Calibrated on the real corpus (4 568 articles, 2026-06-12) — see
    # scripts/calibrate_v2_contrastive.py. All known spam < -0.12 ; legitimate
    # content (incl. non-English) > -0.10.
    # < t_low = off_topic (skips LLM stages) · >= t_high = on_topic · between = borderline
    relevance_t_low: float = -0.12
    relevance_t_high: float = 0.05

    # Idle re-review: when the pipeline has nothing else to do, re-inject a
    # small flow of legacy scored articles to re-enrich + re-score them.
    review_enabled: bool = True
    review_batch: int = 8     # articles re-injected per re-review burst
    review_cooldown_minutes: int = 5   # re-review also pauses while a collection ran this recently (give fresh a clear runway)
    review_interval_seconds: int = 240  # minimum gap between re-review bursts → the pipeline rests at 100% between them (clearly secondary, doesn't monopolise the GPU)

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
