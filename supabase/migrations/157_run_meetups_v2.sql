-- 157_run_meetups_v2.sql
--
-- "לרוץ ביחד" v2 (mockup ~/.cache/madregot/run-together-v2.html, Ofer 2026-10-19):
-- a run says what it is and where exactly, who it is for, and the people going can
-- talk. Joining becomes one tap (a request is inserted 'accepted'), so no new
-- status is needed for that.
--
--   kind      easy | long | quality | recovery  — the card's first words
--   lat, lng  the meeting point, from the map or a club spot
--   audience  pack | club — who is told (the host's pack, or everyone)

ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'club';

CREATE TABLE IF NOT EXISTS run_meetup_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meetup_id UUID NOT NULL REFERENCES run_meetups(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_run_meetup_messages_meetup ON run_meetup_messages (meetup_id, created_at);

ALTER TABLE run_meetup_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages run meetup messages" ON run_meetup_messages;
CREATE POLICY "Service role manages run meetup messages"
  ON run_meetup_messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
