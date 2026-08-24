-- Real kudos (reactions) on a teammate's run — previously "kudos_activity"
-- notifications were purely informational with no way to react back. One
-- kudos per athlete per activity; giving it a second time is a no-op, not a
-- duplicate.
CREATE TABLE IF NOT EXISTS activity_kudos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES athlete_activities(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_kudos_activity ON activity_kudos(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_kudos_athlete ON activity_kudos(athlete_id);
