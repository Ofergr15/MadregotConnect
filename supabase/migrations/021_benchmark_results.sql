-- Benchmark / time-trial results (e.g. a 2000m test).
-- Name-based: results exist for people who may not be registered athletes, so
-- athlete_name is the source of truth and athlete_id is an optional link that we
-- fill in when the name matches a registered athlete (so their profile can show it).
CREATE TABLE IF NOT EXISTS benchmark_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL DEFAULT '2000m',
  athlete_name TEXT NOT NULL,
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  time_seconds NUMERIC NOT NULL,        -- e.g. 346.96 for 5:46.96
  notes TEXT,
  recorded_on DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_results_coach_test ON benchmark_results(coach_id, test_name);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_athlete ON benchmark_results(athlete_id);
