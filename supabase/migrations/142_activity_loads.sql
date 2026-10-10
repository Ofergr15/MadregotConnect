-- The trainee experience (mockup trainee-experience-v2.html): the load (⚡ עומס) of every
-- activity we have priced, our rTSS.
--
-- One row per activity EVALUATED, including the ones with no load, so "what is still
-- missing" is a diff and a run nobody can price is not re-priced on every read:
--   source 'pace'      per-lap or per-km segments, against the test valid on the run's date
--          'pace_avg'  no laps or splits: one segment at the moving average (an estimate)
--          'hr'        no usable test: the heart-rate fallback (spec 3.1)
--          'none'      a run neither can price; `load` NULL; counts toward the 20% rule
--          'not_run'   bike, swim, gym; `load` NULL; does NOT count toward the 20% rule
-- `activity_date` is the Israel local date of `start_time`. `basis_test_date` is the test
-- valid on that date (whatever the source), `formula_version` is LOAD_VERSION in
-- lib/academy/load.ts: either one moving is what makes a row stale and re-priced.
--
-- Fitness, fatigue and form are NOT stored: they are computed on every read from these
-- rows (plan §1.2), so a late sync or a new test can never leave a cached day behind.
--
-- OPTIONAL. Without it every load is computed in memory over the last 100 days of laps
-- and splits (lib/academy/load-server.ts), nothing is written, and a longer history
-- shows "learning" where 42 days are not covered.
--
-- Locked like every table since 134: RLS on, nothing for anon/authenticated, service role
-- only through the API.

CREATE TABLE IF NOT EXISTS activity_loads (
  activity_id UUID PRIMARY KEY REFERENCES athlete_activities(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  load SMALLINT CHECK (load IS NULL OR (load >= 0 AND load <= 2000)),
  source TEXT NOT NULL CHECK (source IN ('pace', 'pace_avg', 'hr', 'none', 'not_run')),
  threshold_sec NUMERIC(6,1),
  basis_test_date DATE,
  formula_version SMALLINT NOT NULL DEFAULT 1,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_loads_athlete_date
  ON activity_loads(athlete_id, activity_date);
ALTER TABLE activity_loads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE activity_loads FROM anon, authenticated;
GRANT ALL ON TABLE activity_loads TO service_role;
