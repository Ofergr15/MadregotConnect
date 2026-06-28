-- Migration: Add athlete_activities table for Garmin activity sync
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS athlete_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  garmin_activity_id BIGINT NOT NULL,
  activity_name TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'running',
  start_time TIMESTAMPTZ NOT NULL,
  distance NUMERIC NOT NULL DEFAULT 0,
  duration NUMERIC NOT NULL DEFAULT 0,
  average_pace NUMERIC,
  average_hr NUMERIC,
  max_hr NUMERIC,
  calories NUMERIC,
  elevation_gain NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(athlete_id, garmin_activity_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_activities_athlete ON athlete_activities(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_activities_start ON athlete_activities(start_time DESC);

ALTER TABLE athlete_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches can manage own athlete activities"
  ON athlete_activities FOR ALL
  USING (
    athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())
  );
