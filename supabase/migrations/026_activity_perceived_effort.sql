-- Garmin "Self Evaluation" (the post-run prompt): Perceived Effort + How did it feel.
-- These live in the activity's summaryDTO as `directWorkoutRpe` (RPE x10) and
-- `directWorkoutFeel` (0/25/50/75/100), and are only present when the athlete
-- answered the prompt on-watch. Stored here on human scales:
--   perceived_rpe  = directWorkoutRpe / 10   -> 0..10
--   perceived_feel = directWorkoutFeel / 25  -> 0..4 (0=weak/poor ... 4=strong/great)
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS perceived_rpe NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS perceived_feel NUMERIC;
