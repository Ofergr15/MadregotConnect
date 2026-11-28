-- Task 153: the server model behind the native "Edit Alarm"-style composer for scheduled
-- messages and polls: a send time, repeat days, an audience, importance and a push toggle.
--
-- A table of its own, NOT scheduled_notifications: /api/cron/notifications sends every due
-- row of that table every minute, so a composer row there would be sent for real. These
-- rows are only read by /api/cron/scheduled-composer, which is a DRY RUN: it records what
-- it would have sent (scheduled_composer_dry_runs) and moves next_run_at on. Nothing is
-- pushed and nothing reaches an inbox. Idempotent; service role only.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS scheduled_composer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'poll')),
  title_he TEXT NOT NULL,
  body_he TEXT,
  poll_options_he TEXT[],                       -- poll only, 2..8 options
  audience_type TEXT NOT NULL DEFAULT 'all' CHECK (audience_type IN ('all', 'group', 'athlete', 'academy')),
  audience_id UUID,                             -- pack or athlete id; no FK (see 145 on embed paths)
  send_time TEXT NOT NULL CHECK (send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),   -- Israel wall clock
  repeat_days INT[] NOT NULL DEFAULT '{}',      -- 0=Sun..6=Sat; empty = once, on once_date
  once_date DATE,
  importance TEXT NOT NULL DEFAULT 'normal' CHECK (importance IN ('normal', 'high')),
  push BOOLEAN NOT NULL DEFAULT true,           -- false = inbox only
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ,                      -- null = nothing ahead (a past one-off, or disabled)
  last_dry_run_at TIMESTAMPTZ,
  created_by_athlete_id UUID,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_composer_due ON scheduled_composer_items (enabled, next_run_at);

CREATE TABLE IF NOT EXISTS scheduled_composer_dry_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES scheduled_composer_items(id) ON DELETE CASCADE,
  occurrence_at TIMESTAMPTZ NOT NULL,
  audience_count INT NOT NULL DEFAULT 0,
  push_device_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, occurrence_at)               -- two overlapping ticks record one occurrence once
);

ALTER TABLE scheduled_composer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_composer_dry_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE scheduled_composer_items FROM anon, authenticated;
REVOKE ALL ON TABLE scheduled_composer_dry_runs FROM anon, authenticated;
GRANT ALL ON TABLE scheduled_composer_items TO service_role;
GRANT ALL ON TABLE scheduled_composer_dry_runs TO service_role;
