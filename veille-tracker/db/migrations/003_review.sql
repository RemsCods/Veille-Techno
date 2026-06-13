-- Migration 003 — Idle re-review (2026-06-13)
-- A large part of the corpus was scored by OLDER pipeline versions (old
-- confidence formula, single-model fact-check, no LLM relevance verdict).
-- When the pipeline is idle it now re-injects a small flow of those articles
-- to re-enrich + re-score them. We track WHICH version last processed each
-- article and WHEN it was last re-reviewed, so the sweep is fair (never review
-- one twice while others have never been reviewed) and we can show old→new score.
--
-- Apply on the live DB after backup:
--   docker exec -i veille-tracker-db-1 mariadb -uveille -p"$DB_PASSWORD" veille < db/migrations/003_review.sql

ALTER TABLE articles
  -- version of the enrich/score pipeline that last fully processed this article.
  -- Existing rows default to 1 (legacy) → eligible for the v2 re-review sweep.
  -- The scorer/enricher/gate stamp CURRENT_PIPELINE_VERSION (=2) at terminal states.
  ADD COLUMN pipeline_version          SMALLINT NOT NULL DEFAULT 1 AFTER status,
  -- when the article was last re-injected into the pipeline for review (NULL = never).
  ADD COLUMN reviewed_at               DATETIME NULL               AFTER pipeline_version,
  -- confidence_score before the most recent re-review (for old→new display).
  ADD COLUMN previous_confidence_score FLOAT    NULL               AFTER confidence_score,
  -- serves the reviewer selection: WHERE status='score' AND pipeline_version < :current
  ADD INDEX idx_review (status, pipeline_version);
