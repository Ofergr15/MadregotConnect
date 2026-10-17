-- A run the athlete takes out of their personal records, without deleting it.
--
-- Migration 104 lets an athlete hide a whole DISTANCE ("my 5K record is wrong"),
-- which leaves that distance with no record at all. The common case is narrower:
-- one run is wrong — a GPS jump, a bike ride saved as a run, a friend's watch — and
-- the next real best should simply take its place. Ofer, 2026-10-17: "I need to be
-- able to go into the run, see which records it broke, and remove the records
-- without deleting the run."
--
-- The run itself stays everywhere else: the feed, weekly volume, statistics,
-- challenges. Only `computeDistanceBests` (lib/prs/pr-buckets.ts) skips it, so the
-- profile, the record screen, the club board and the PR badge all move together.
--
-- `bucket_key` is one distance ('5k' | '10k' | 'hm' | 'fm', PR_BUCKETS in
-- pr-buckets.ts) or '*' for every distance. TEXT, not an enum, so a new bucket stays
-- a code change.

CREATE TABLE IF NOT EXISTS athlete_pr_exclusions (
  -- No REFERENCES athletes: with keys to both athletes and athlete_activities in
  -- its primary key this table was a second athlete_activities↔athletes path, and
  -- /api/activities 500'd (PGRST201) for six hours on 2026-10-17 until the key was
  -- dropped on prod. This file now matches prod; schemaEmbedAmbiguity.test.ts guards it.
  athlete_id  UUID NOT NULL,
  activity_id UUID NOT NULL REFERENCES athlete_activities(id) ON DELETE CASCADE,
  bucket_key  TEXT NOT NULL DEFAULT '*',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, activity_id, bucket_key)
);

-- Read per athlete (the profile) and for the whole club at once (the board).
CREATE INDEX IF NOT EXISTS athlete_pr_exclusions_athlete ON athlete_pr_exclusions (athlete_id);

-- Server routes only, through the service role (134_lock_public_tables).
ALTER TABLE athlete_pr_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE athlete_pr_exclusions FROM anon, authenticated;

COMMENT ON TABLE athlete_pr_exclusions IS
  'Runs an athlete took out of their personal records (one distance, or * for all) without deleting the run.';
