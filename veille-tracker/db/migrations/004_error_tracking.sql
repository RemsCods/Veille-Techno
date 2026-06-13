-- Migration 004 — Error tracking / retry cap (2026-06-14)
-- A failing article was retried every pipeline cycle forever (poison loop):
-- wasted CPU + LLM calls and, via the in-memory stats counters, leaked memory.
-- error_count lets the workers PARK an article after MAX_PIPELINE_ATTEMPTS
-- failures (no longer auto-claimed) and lets the admin list / re-run / delete it.
--
-- Apply on the live DB:
--   docker exec -i veille-tracker-db-1 sh -c 'mariadb -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < db/migrations/004_error_tracking.sql

ALTER TABLE articles
  ADD COLUMN error_count INT NOT NULL DEFAULT 0 AFTER reviewed_at,
  ADD COLUMN last_error  VARCHAR(500) NULL      AFTER error_count,
  ADD INDEX idx_error (error_count);
