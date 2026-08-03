-- Post-workout questionnaire (PRD §1). One structured feedback record per
-- completed activity. Pre-filled from the watch's Self-Evaluation when present
-- (athlete_activities.perceived_rpe / perceived_feel, migration 026) and the
-- form adapts its follow-up questions accordingly.
CREATE TABLE IF NOT EXISTS workout_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  garmin_activity_id BIGINT,             -- the run this feedback is about (nullable for ad-hoc)
  difficulty INT,                        -- perceived difficulty 1..10
  feel INT,                              -- how did you feel 0..4 (weak..great)
  pain BOOLEAN,                          -- any pain / discomfort?
  pain_detail TEXT,                      -- optional description when pain = true
  wants_feedback BOOLEAN,                -- wants the coach to reach out?
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(athlete_id, garmin_activity_id)
);
CREATE INDEX IF NOT EXISTS idx_workout_feedback_athlete ON workout_feedback(athlete_id);
CREATE INDEX IF NOT EXISTS idx_workout_feedback_created ON workout_feedback(created_at DESC);
