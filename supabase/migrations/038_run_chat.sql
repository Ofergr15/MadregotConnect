-- Run Chat: one conversation thread per activity, with AI coach support.
-- Apply manually in the Supabase SQL Editor.

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS run_chats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id       UUID NOT NULL REFERENCES athlete_activities(id) ON DELETE CASCADE,
  athlete_id        UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  coach_id          UUID REFERENCES athletes(id) ON DELETE SET NULL,
  stream_channel_id TEXT,           -- "messaging:run-{activityId}"
  planned_text      TEXT,           -- seeded workout, editable by coach
  planned_workout   JSONB,          -- parsed structure; NULL until parsed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT run_chats_activity_unique UNIQUE (activity_id)
);

CREATE INDEX IF NOT EXISTS idx_run_chats_athlete   ON run_chats(athlete_id);
CREATE INDEX IF NOT EXISTS idx_run_chats_coach     ON run_chats(coach_id);
CREATE INDEX IF NOT EXISTS idx_run_chats_activity  ON run_chats(activity_id);

-- Enable Realtime publication so clients can subscribe to row-level changes.
-- (Only needed if we add a hybrid Supabase-Realtime layer later; included now
-- so we don't have to remember to add it.)
ALTER PUBLICATION supabase_realtime ADD TABLE run_chats;

-- ─── Test identities ─────────────────────────────────────────────────────────
-- athletes.coach_id FK references coaches(id), so insert there first.
-- Uses WHERE NOT EXISTS throughout so re-running is safe.

INSERT INTO coaches (id, email, name)
SELECT
  'aaaaaaaa-0000-0000-0000-000000000002',
  'test-coach@madregot.local',
  'Test Coach'
WHERE NOT EXISTS (
  SELECT 1 FROM coaches WHERE email = 'test-coach@madregot.local'
);

INSERT INTO athletes (id, name, email, role, status, coach_id, approved, approved_at)
SELECT
  'aaaaaaaa-0000-0000-0000-000000000002',
  'Test Coach',
  'test-coach@madregot.local',
  'coach',
  'active',
  'aaaaaaaa-0000-0000-0000-000000000002',
  true,
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM athletes WHERE email = 'test-coach@madregot.local'
);

INSERT INTO athletes (id, name, email, role, status, coach_id, approved, approved_at)
SELECT
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Test Runner',
  'test-runner@madregot.local',
  'runner',
  'active',
  'aaaaaaaa-0000-0000-0000-000000000002',
  true,
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM athletes WHERE email = 'test-runner@madregot.local'
);

-- Re-runs / earlier seeds left approved=false (column default). Unblock them.
UPDATE athletes
SET approved = true,
    approved_at = COALESCE(approved_at, now()),
    status = 'active'
WHERE email IN ('test-runner@madregot.local', 'test-coach@madregot.local');

-- One synthetic activity so the workout card has real data on a fresh DB.
-- start_time is stored as local wall-clock in a TIMESTAMPTZ column (see CLAUDE.md).
INSERT INTO athlete_activities (
  id, athlete_id, garmin_activity_id, source, activity_name, activity_type,
  start_time, distance, duration, average_pace, average_hr,
  laps
)
SELECT
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  -1,     -- sentinel; garmin_activity_id is NOT NULL but this is a Strava test row
  'strava',
  'אינטרוולים 1000מ',
  'running',
  '2026-08-06 07:00:00+03:00',
  8000,   -- 8.0 km (2k + 5×1.4k + 2k)
  2400,   -- 40 min
  300,    -- 5:00 /km average
  158,
  '[
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
WHERE NOT EXISTS (
  SELECT 1 FROM athlete_activities WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
);
