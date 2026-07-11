-- Migration: store weekly km per athlete (and, by aggregation, per group) so
-- the numbers can be shared/reported later even after activities change.
-- Run this in the Supabase SQL Editor.
--
-- week_start is the MONDAY of the activity week (matches Garmin/Strava
-- reporting, same as getActivityWeekStart in the app). One row per athlete per
-- week; group_id is denormalized for easy per-group rollups.

CREATE TABLE IF NOT EXISTS weekly_km_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  week_start DATE NOT NULL,
  distance_m NUMERIC NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  duration_s NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(athlete_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_km_week ON weekly_km_snapshots(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_km_group_week ON weekly_km_snapshots(group_id, week_start);

ALTER TABLE weekly_km_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches can manage own weekly km snapshots"
  ON weekly_km_snapshots FOR ALL
  USING (
    athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())
  );
