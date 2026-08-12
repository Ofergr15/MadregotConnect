-- Run chat: persist Garmin clipboard image URL (generated once on first open).
-- Apply manually in the Supabase SQL Editor.

ALTER TABLE run_chats
  ADD COLUMN IF NOT EXISTS clipboard_image_url TEXT;

-- Refresh the seeded test activity so the name + laps match the mock prompt
-- "2ק״מ חימום + 5×1000מ …"
UPDATE athlete_activities
SET
  activity_name = 'אינטרוולים 1000מ',
  distance = 8000,
  duration = 2400,
  average_pace = 300,
  average_hr = 158,
  laps = '[
    {"index":1,"distance":2000,"moving_time":600,"average_speed":3.33,"average_heartrate":145,"name":"Warmup"},
    {"index":2,"distance":1000,"moving_time":210,"average_speed":4.76,"average_heartrate":168,"name":"Lap 1"},
    {"index":3,"distance":400, "moving_time":160,"average_speed":2.50,"average_heartrate":155,"name":"Recovery"},
    {"index":4,"distance":1000,"moving_time":212,"average_speed":4.72,"average_heartrate":170,"name":"Lap 2"},
    {"index":5,"distance":400, "moving_time":162,"average_speed":2.47,"average_heartrate":158,"name":"Recovery"},
    {"index":6,"distance":1000,"moving_time":208,"average_speed":4.81,"average_heartrate":172,"name":"Lap 3"},
    {"index":7,"distance":400, "moving_time":165,"average_speed":2.42,"average_heartrate":160,"name":"Recovery"},
    {"index":8,"distance":1000,"moving_time":214,"average_speed":4.67,"average_heartrate":173,"name":"Lap 4"},
    {"index":9,"distance":400, "moving_time":168,"average_speed":2.38,"average_heartrate":162,"name":"Recovery"},
    {"index":10,"distance":1000,"moving_time":211,"average_speed":4.74,"average_heartrate":171,"name":"Lap 5"},
    {"index":11,"distance":400, "moving_time":170,"average_speed":2.35,"average_heartrate":160,"name":"Recovery"},
    {"index":12,"distance":2000,"moving_time":720,"average_speed":2.78,"average_heartrate":148,"name":"Cooldown"}
  ]'::jsonb
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- Public bucket for clipboard PNGs (create via dashboard if this fails — storage DDL
-- sometimes needs the Storage API rather than SQL).
INSERT INTO storage.buckets (id, name, public)
VALUES ('run-chat', 'run-chat', true)
ON CONFLICT (id) DO NOTHING;
