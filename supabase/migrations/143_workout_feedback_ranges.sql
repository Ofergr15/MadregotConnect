-- The trainee's answer about a run (workout_feedback, migration 030) in its own ranges:
-- feel 0–4 (חלש מאוד … חזק מאוד), difficulty 1–10. POST /api/workout-feedback already
-- refuses anything else; this is the table saying the same, because the readiness check
-- averages feel over the last answers and one feel of 9 lifts a held pace suggestion.
--
-- NOT VALID: a row stored before the route checked is left alone rather than failing the
-- paste; every new or updated row is held to it.
--
-- OPTIONAL. The route validates either way.

ALTER TABLE workout_feedback DROP CONSTRAINT IF EXISTS workout_feedback_feel_range;
ALTER TABLE workout_feedback ADD CONSTRAINT workout_feedback_feel_range
  CHECK (feel IS NULL OR (feel >= 0 AND feel <= 4)) NOT VALID;
ALTER TABLE workout_feedback DROP CONSTRAINT IF EXISTS workout_feedback_difficulty_range;
ALTER TABLE workout_feedback ADD CONSTRAINT workout_feedback_difficulty_range
  CHECK (difficulty IS NULL OR (difficulty >= 1 AND difficulty <= 10)) NOT VALID;
