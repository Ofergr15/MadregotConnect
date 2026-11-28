-- 251 — cron_runs: one row per cron run (start, end, counts, error) — round-4 task 93.
-- Paste by hand. Idempotent; safe to paste twice. Until applied, crons run exactly as before
-- (the run-row writes are best-effort and skipped on a missing table) and
-- GET /api/admin/cron-runs answers 503.
--
-- Service role only (RLS on, no policies). Small: ~11 crons × a few runs/day; the helper
-- deletes rows older than 30 days for the cron it just ran.

CREATE TABLE IF NOT EXISTS cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  http_status int,
  counts jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS cron_runs_name_started_idx ON cron_runs (name, started_at DESC);
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;  -- service role only

DO $$ BEGIN
  REVOKE ALL ON TABLE cron_runs FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- VERIFY (expect 1 row, rowsecurity = true):
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'cron_runs';
