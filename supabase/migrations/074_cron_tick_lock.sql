-- Prevents cron/tick from double-firing if one invocation takes longer than
-- the 5-minute interval (much more likely once the athlete count/audience
-- size grows) — Vercel Cron does not guarantee mutual exclusion between
-- invocations on its own. A single INSERT with a UNIQUE constraint is
-- atomic in Postgres, unlike a separate read-then-write check, so this is
-- race-safe even if two invocations somehow start within the same instant.
CREATE TABLE IF NOT EXISTS cron_tick_locks (
  tick_at TIMESTAMPTZ PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
