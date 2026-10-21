-- 166: the wall-clock time of a run, pauses included (#136, Ofer 2026-10-20: "Ofer's run
-- shows different times than Strava"). Garmin's `duration` is the TIMER time, so a run
-- with stops read 40:07 total / 40:04 moving where Strava says 41:36 elapsed / 40:07
-- moving. Garmin's elapsedDuration and Strava's elapsed_time land here; NULL = unknown
-- (older rows, until they sync again), and the run page then falls back to `duration`.
-- Paste as one block; safe to run twice.
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS elapsed_duration INTEGER;
NOTIFY pgrst, 'reload schema';
