-- Add Strava support columns to athletes
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_auth JSONB;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'garmin';
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_athlete_id BIGINT;

-- Add source tracking to activities
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'garmin';
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS strava_activity_id BIGINT;

-- Allow Strava activities to coexist (unique per source)
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_strava_unique
  ON athlete_activities(athlete_id, strava_activity_id)
  WHERE strava_activity_id IS NOT NULL;
