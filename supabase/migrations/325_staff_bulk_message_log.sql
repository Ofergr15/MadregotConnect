-- Task 151: an audit row for every staff bulk-message action ("who hasn't run" → message them).
--
-- Today only the dry run exists (POST /api/admin/not-run/message): it says who WOULD get the
-- message, and through which channel, and sends nothing. Each one is written here, and the
-- same rows are the rate limit (20 an hour per staff member), so the audit and the limit can
-- never disagree. Idempotent; service role only.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS staff_bulk_message_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,                         -- 'not_run_dry_run'
  dry_run BOOLEAN NOT NULL DEFAULT true,
  group_id UUID,                                -- the filter; null = the whole club
  no_group BOOLEAN NOT NULL DEFAULT false,      -- the filter was "members with no pack"
  text TEXT NOT NULL,
  recipient_count INT NOT NULL DEFAULT 0,
  push_count INT NOT NULL DEFAULT 0,
  inbox_only_count INT NOT NULL DEFAULT 0,
  muted_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_bulk_message_log_actor_time
  ON staff_bulk_message_log(actor_athlete_id, created_at DESC);

ALTER TABLE staff_bulk_message_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages staff bulk message log" ON staff_bulk_message_log;
CREATE POLICY "Service role manages staff bulk message log"
  ON staff_bulk_message_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
