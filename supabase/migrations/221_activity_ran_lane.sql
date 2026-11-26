-- 221: "I ran with pack N" on one run.
--
-- A runner's assigned pack is where they usually run, not a fact about every run.
-- The verdict detects the pack a run was run with (lib/plan-execution/ran-lane.ts);
-- this is the runner's (or staff's) own answer, which wins over the detection.
-- Set by POST /api/activities/{id}/lane (self-or-staff). NULL = not stated.
-- Kept across re-matching: matchAthleteActivities carries it onto the rebuilt row.

ALTER TABLE activity_plan_matches
  ADD COLUMN IF NOT EXISTS ran_lane SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_plan_matches_ran_lane_check'
  ) THEN
    ALTER TABLE activity_plan_matches
      ADD CONSTRAINT activity_plan_matches_ran_lane_check CHECK (ran_lane IS NULL OR ran_lane BETWEEN 1 AND 3);
  END IF;
END $$;
