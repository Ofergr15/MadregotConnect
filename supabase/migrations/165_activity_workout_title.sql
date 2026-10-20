-- 165: what a run was ("10 × 1600"), read off the watch's workout at sync, so search can find it.
-- Paste as one block in the Supabase SQL editor; safe to run twice.
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS workout_title text;
