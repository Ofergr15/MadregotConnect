-- Add extra fields to athlete_activities for richer display
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS start_lat NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS start_lng NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS end_lat NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS end_lng NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS moving_duration NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS avg_cadence NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS avg_stride_length NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS vo2max NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS lap_count INTEGER;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS splits JSONB;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS has_polyline BOOLEAN DEFAULT false;

-- Add activities tab permission for all roles
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'activities', true),
  ('coach', 'activities', true),
  ('runner', 'activities', true),
  ('viewer', 'activities', false)
ON CONFLICT (role, tab) DO NOTHING;
