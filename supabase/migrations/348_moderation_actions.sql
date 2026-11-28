-- 348_moderation_actions.sql — task 185 (staff moderation API). Idempotent.
--
-- The audit trail of staff decisions on content reports: one row per dismiss / resolve / hide,
-- taken on a report's TARGET (every open report on it is closed at once; reports_closed says how
-- many). outcome = dismissed | actioned | hidden | missing. Service role only. Needs 203.

CREATE TABLE IF NOT EXISTS moderation_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         uuid,
  target_type       text NOT NULL,
  target_id         text NOT NULL,
  action            text NOT NULL CHECK (action IN ('dismiss', 'resolve', 'hide')),
  outcome           text NOT NULL,
  actor_athlete_id  uuid,
  note              text CHECK (note IS NULL OR char_length(note) <= 500),
  reports_closed    integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_actions_created_idx ON moderation_actions (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS moderation_actions_target_idx ON moderation_actions (target_type, target_id, created_at DESC);
-- The moderation queue pages content_reports by (status, created_at, id).
CREATE INDEX IF NOT EXISTS content_reports_status_created_idx ON content_reports (status, created_at DESC, id DESC);

ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  REVOKE ALL ON TABLE moderation_actions FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
GRANT ALL ON TABLE moderation_actions TO service_role;
