-- Migration: persist each activity's route polyline so maps load instantly and
-- reliably instead of being fetched live from Garmin on every open (which was
-- inconsistent). Run this in the Supabase SQL Editor.
--
-- gps_points is a JSONB array of { lat, lng }. NULL = not yet fetched;
-- an empty array [] = confirmed no GPS (e.g. treadmill / indoor run).

ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS gps_points JSONB;
