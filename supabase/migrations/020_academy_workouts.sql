-- Academy workout library
-- Reusable single-workout templates the coach builds in-app (structured editor)
-- and reuses across athletes/weeks. `workout` is a ParsedWorkout JSON blob
-- (name + steps), same shape used everywhere else in the app.
CREATE TABLE IF NOT EXISTS academy_workouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  workout JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_workouts_coach ON academy_workouts(coach_id);
