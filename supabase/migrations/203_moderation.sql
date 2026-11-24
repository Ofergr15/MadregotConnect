-- 203 — moderation: content reports + member blocks (App Store guideline 1.2).
-- Paste by hand in the Supabase SQL editor. Idempotent. Until it is applied the
-- /api/moderation/* routes answer 503 and the native client falls back to
-- /api/feedback; the feed and comment filters fail open (nobody is blocked).
--
-- 1. content_reports — one row per "report this" tap. Read by staff only, via the
--    service role. The reporter is never shown to the reported author.
-- 2. athlete_blocks — who a member has blocked. Private to the blocker.
-- 3. Routing seed for the new management kind `content_report`.
--
-- One FK to athletes per table only (a second would make every unhinted embed
-- ambiguous — CLAUDE.md "125 took the feed down"); the other athlete ids are bare uuids.

-- 1 ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('feed_item','comment','run_chat_message','academy_message','photo')),
  target_id text NOT NULL,
  author_athlete_id uuid,
  reason text NOT NULL CHECK (reason IN ('offensive','harassment','spam','privacy','other')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  handled_by uuid
);
CREATE INDEX IF NOT EXISTS content_reports_open_idx ON content_reports (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS content_reports_target_idx ON content_reports (target_type, target_id);
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;  -- service role only

-- 2 ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS athlete_blocks (
  blocker_athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  blocked_athlete_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_athlete_id, blocked_athlete_id),
  CHECK (blocker_athlete_id <> blocked_athlete_id)
);
CREATE INDEX IF NOT EXISTS athlete_blocks_blocked_idx ON athlete_blocks (blocked_athlete_id);
ALTER TABLE athlete_blocks ENABLE ROW LEVEL SECURITY;  -- service role only

DO $$ BEGIN
  REVOKE ALL ON TABLE content_reports FROM anon, authenticated;
  REVOKE ALL ON TABLE athlete_blocks FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- 3 ─────────────────────────────────────────────────────────────────────────────
INSERT INTO notification_routing (kind, role, enabled) VALUES
  ('content_report', 'admin', true),
  ('content_report', 'coach', true),
  ('content_report', 'academy_coach', false)
ON CONFLICT (kind, role) DO NOTHING;
