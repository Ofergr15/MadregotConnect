-- Strava-style follow graph (roadmap: social follow system). This is a closed
-- running club, not a public platform, so unlike Strava there is no private-
-- account/approval-request concept — follow is asymmetric and instant, same
-- as clicking Follow on a public Strava profile. No mutual-follow requirement,
-- no follow_requests table.
--
-- One row = "follower_id follows followee_id". The CHECK blocks self-follow;
-- the UNIQUE constraint makes a repeat POST a no-op (ON CONFLICT DO NOTHING
-- at the call site) instead of a duplicate row.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS athlete_follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, followee_id),
  CHECK (follower_id != followee_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_follows_follower
  ON athlete_follows (follower_id);

CREATE INDEX IF NOT EXISTS idx_athlete_follows_followee
  ON athlete_follows (followee_id);

ALTER TABLE athlete_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages athlete follows" ON athlete_follows;
CREATE POLICY "Service role manages athlete follows"
  ON athlete_follows FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
