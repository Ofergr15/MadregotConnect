-- A trainee's goal: the race, its day, and the finish time they want (mockup
-- academy-existing-trainees: "מטרה · מרוץ וזמן", and the trainee's own "המטרה שלך").
--
-- Its own table, one row per trainee, because the characterization's goal fields hang off a
-- candidate row (migration 111), and the trainees who were in the academy before the funnel
-- (the ones this screen exists for) have none. The characterization has no goal TIME at all.
-- lib/academy/goal-server.ts reads this first and the characterization as the fallback.
--
-- goal_type uses the characterization's own values ('half' | 'full' | '10k' | 'fitness'), with
-- no CHECK for the same reason as there: the choices are product and live in the code.
--
-- updated_by carries no foreign key on purpose: a second key to athletes would make every
-- unhinted embed between the two tables ambiguous (schemaEmbedAmbiguity.test.ts).
--
-- OPTIONAL until pasted: without it a goal save answers 503 and the form says why; every read
-- falls back to the characterization.

CREATE TABLE IF NOT EXISTS academy_goals (
  athlete_id UUID PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
  goal_type TEXT,
  target_race TEXT,
  target_race_date DATE,
  goal_time_sec INTEGER CHECK (goal_time_sec IS NULL OR (goal_time_sec >= 600 AND goal_time_sec <= 36000)),
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE academy_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE academy_goals FROM anon, authenticated;
GRANT ALL ON TABLE academy_goals TO service_role;
