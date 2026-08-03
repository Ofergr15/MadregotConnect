-- Pre-workout attendance / RSVP (PRD §14). An athlete confirms in advance whether
-- they'll join a given day's workout, and which דבוקה (group) they'll run with.
-- Keyed by (athlete, week_start_date = Sunday, day_of_week 0=Sun..6=Sat) so it
-- lines up with how the app dates workouts (week_start_date + dayOfWeek).
CREATE TABLE IF NOT EXISTS workout_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  day_of_week INT NOT NULL,              -- 0=Sun .. 6=Sat
  attending BOOLEAN NOT NULL,            -- true = coming, false = not this time
  group_label TEXT,                      -- chosen דבוקה (e.g. 'דבוקה 2' or free text)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(athlete_id, week_start_date, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_workout_attendance_day
  ON workout_attendance(week_start_date, day_of_week);
