-- Strava raw route data for run-chat actuals (GPX URL + optional streams).
-- Apply manually or via `supabase db push` on the sandbox project.

ALTER TABLE athlete_activities
  ADD COLUMN IF NOT EXISTS strava_gpx_url TEXT;

ALTER TABLE athlete_activities
  ADD COLUMN IF NOT EXISTS strava_streams JSONB;

-- New athletes default to Strava as the activity source.
ALTER TABLE athletes
  ALTER COLUMN data_source SET DEFAULT 'strava';

-- Public bucket for GPX + laps images (create via dashboard if this fails).
INSERT INTO storage.buckets (id, name, public)
VALUES ('run-chat', 'run-chat', true)
ON CONFLICT (id) DO NOTHING;
