-- 203: strength training (review-2026-11-20/strength/plan.md, flag strength_training).
-- Paste by hand in the Supabase SQL editor. Safe to re-run.
--
-- athlete_activities.exercise_sets: the narrowed Garmin set list of a strength session,
-- [{ category, name, reps, weightKg, durationSec }] (lib/activities/strength.ts). Garmin only;
-- Strava's WeightTraining has no sets. NULL for every run and for a session whose sets were
-- not fetched. Every route reading it tolerates the column being absent (42703 → no sets).
--
-- Strength rows themselves use the existing columns: activity_type = 'strength_training',
-- distance = 0, average_pace = NULL. Every km/run reader filters them out through
-- lib/activities/kinds.ts (RUNS_ONLY_OR).
-- Sets now also keep REST entries ({ kind: 'rest', durationSec, startTime }) and each set's
-- startTime, so the detail draws work vs rest on the HR chart. Counts read kind <> 'rest'.
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS exercise_sets jsonb;

-- strength_hr: { t: [sec from start], hr: [bpm] } every 5 s, from Garmin activity details, for
-- the detail's HR chart (a strength session has no distance axis, so activity_streams' parser
-- does not apply). Garmin only, fetched for the same capped sessions as the sets.
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS strength_hr jsonb;

-- suffer_score: Strava Relative Effort, for a Strava-only strength session (Garmin rows carry
-- aerobic/anaerobic Training Effect + load in the existing training_effect column, migration 160).
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS suffer_score integer;

-- The week/adherence read (activities/strength/week) asks by type + athlete + time.
CREATE INDEX IF NOT EXISTS athlete_activities_strength_idx
  ON athlete_activities (athlete_id, start_time)
  WHERE activity_type = 'strength_training';
