-- Attribute an activity to the workout it was actually run from, using Garmin's
-- own answer instead of a distance-and-day guess.
--
-- When an athlete starts a scheduled structured workout on the watch, Garmin
-- stamps the resulting activity with the workoutId of the workout it came from —
-- the same id `POST /api/garmin/push-workouts` stored in
-- `workout_deliveries.garmin_workout_id`. Capturing it gives two things nothing
-- in this app could previously know:
--
--   1. Proof the watch really received a pushed workout. Verifying the push only
--      proves Garmin's *account* has it (see lib/garmin/delivery.ts); an activity
--      carrying the id proves it reached the device and was run from it.
--   2. Exact plan attribution. lib/plans/activity-matcher.ts otherwise scores
--      candidates on day and distance and takes the best pair over a threshold,
--      which is a good guess and no more.
--
-- Apply this BEFORE deploying the code that writes these columns. Both writers
-- degrade gracefully if it hasn't been (the sync retries the insert without the
-- column, the matcher falls back to the heuristic), but the enrichment backfill
-- at `PATCH /api/garmin/sync-activities?mode=…` will log a per-row error until it
-- exists.

-- Garmin's workoutId for the structured workout this activity was run from.
-- TEXT, matching workout_deliveries.garmin_workout_id, so the join needs no cast.
-- NULL for every run not started from a scheduled workout, and for everything
-- synced from Strava — that is the normal case, not a gap to be filled.
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS garmin_workout_id TEXT;

CREATE INDEX IF NOT EXISTS idx_athlete_activities_garmin_workout
  ON athlete_activities (garmin_workout_id)
  WHERE garmin_workout_id IS NOT NULL;

-- Which published plan part a delivery was, so an activity carrying its Garmin
-- workout id resolves straight to a `workoutKey` instead of being re-derived from
-- the date (which is ambiguous on a double day). Deterministic and stamped by
-- lib/plans/normalize-plan.ts, so it is the same key the matcher persists.
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS workout_key TEXT;

-- When an activity carrying this delivery's workout id first showed up: the
-- moment we learned the watch had it. Deliberately a separate column rather than
-- a new `delivery_status` value — `status` means "did the push land on the
-- account", every reader of it counts 'success' as the good case, and a workout
-- that was delivered but never run is not a failed delivery.
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS device_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workout_deliveries_garmin_workout
  ON workout_deliveries (garmin_workout_id)
  WHERE garmin_workout_id IS NOT NULL AND garmin_workout_id <> '';

-- 'garmin_workout' joins 'auto' and 'manual': a match Garmin itself asserted.
-- Ranked between them — it beats a scored guess, and a coach's explicit override
-- still beats it.
ALTER TABLE activity_plan_matches
  DROP CONSTRAINT IF EXISTS activity_plan_matches_match_method_check;
ALTER TABLE activity_plan_matches
  ADD CONSTRAINT activity_plan_matches_match_method_check
  CHECK (match_method IN ('auto', 'manual', 'garmin_workout'));
