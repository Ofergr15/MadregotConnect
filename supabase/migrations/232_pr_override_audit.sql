-- 232 — audit trail for manually entered records (night task 58).
-- Paste by hand in the Supabase SQL editor. Idempotent; safe to paste twice.
-- One row per PUT / DELETE on /api/athletes/prs: who changed which bucket, from what
-- to what. Until applied the edit still saves and the audit write is skipped.
-- Staff-only: RLS on, no policies (service role). `athlete_id` is the one FK to
-- athletes; `changed_by` stays a bare uuid (CLAUDE.md: a second FK makes embeds ambiguous).

CREATE TABLE IF NOT EXISTS athlete_pr_override_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  bucket_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('set', 'hide', 'clear')),
  seconds integer,
  previous_seconds integer,
  achieved_on date,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_pr_override_events_athlete_idx ON athlete_pr_override_events (athlete_id, changed_at DESC);
ALTER TABLE athlete_pr_override_events ENABLE ROW LEVEL SECURITY;  -- service role only

DO $$ BEGIN
  REVOKE ALL ON TABLE athlete_pr_override_events FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
