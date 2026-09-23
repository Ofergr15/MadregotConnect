CREATE TABLE IF NOT EXISTS athlete_wellness (athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE, date date NOT NULL, sleep_seconds integer, resting_hr integer, source text NOT NULL DEFAULT 'garmin', fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (athlete_id, date));
ALTER TABLE athlete_wellness ENABLE ROW LEVEL SECURITY;
