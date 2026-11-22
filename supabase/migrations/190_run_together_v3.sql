-- 190_run_together_v3.sql
--
-- "ריצות משותפות" v3 — the native build of the approved prototype
-- (design/run-together-prototype, Ofer 2026-11-21, all 8 defaults accepted).
--
--   visibility   club | squad | private   (supersedes audience club|pack; pack → squad)
--   squad_id     the squad a squad run is for (the host's group at create time)
--   capacity     null = no limit; a full run puts new joiners on the waitlist
--   plan_id/plan_day   "the workout of the day, together" — the plan block per lane
--   spot_id      a club-curated meeting point (run_spots)
--   area_*       what a NON-joiner is shown: a label and a jittered centre. The exact
--                lat/lng/location never leave the server for them (lib/runs/together.ts).
--   updated_time_at / previous_start_time   the red "time changed" notice
--   cancel_note  the host's line on a cancelled run
--   soon_notified_at   the T−60 push has gone (cron/tick)
--
-- Requests gain 'waitlist' and 'left'. Messages gain kind 'system' (time changed …).
-- run_meetup_activities links joiners' runs to the meetup for the group feed card.
--
-- Run this in the Supabase SQL Editor. Idempotent.
-- Embeds: run_meetups gains its FIRST reference to groups, weekly_plans and run_spots,
-- so no existing unhinted embed becomes ambiguous.

CREATE TABLE IF NOT EXISTS run_spots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  area_label TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  -- Jittered centre, fixed per spot so the area circle doesn't wander between loads
  -- (a moving circle averaged over refreshes would converge on the real point).
  area_lat DOUBLE PRECISION NOT NULL,
  area_lng DOUBLE PRECISION NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_spots_name ON run_spots (name);

INSERT INTO run_spots (name, area_label, lat, lng, area_lat, area_lng, sort) VALUES
  ('גשר הירקון',      'פארק הירקון',  32.0998, 34.8115, 32.1009, 34.8102, 1),
  ('מגדלור הנמל',     'נמל תל אביב',  32.0995, 34.7742, 32.0984, 34.7753, 2),
  ('טיילת גורדון',    'טיילת',        32.0852, 34.7702, 32.0863, 34.7713, 3),
  ('פארק הרצליה',     'הרצליה',       32.1655, 34.8205, 32.1644, 34.8194, 4)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS visibility TEXT;
UPDATE run_meetups SET visibility = CASE WHEN audience = 'pack' THEN 'squad' ELSE 'club' END WHERE visibility IS NULL;
ALTER TABLE run_meetups ALTER COLUMN visibility SET DEFAULT 'club';
ALTER TABLE run_meetups ALTER COLUMN visibility SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE run_meetups ADD CONSTRAINT run_meetups_visibility_check CHECK (visibility IN ('club', 'squad', 'private'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS squad_id UUID REFERENCES groups(id) ON DELETE SET NULL;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS capacity INT CHECK (capacity IS NULL OR capacity BETWEEN 2 AND 60);
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES weekly_plans(id) ON DELETE SET NULL;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS plan_day INT CHECK (plan_day IS NULL OR plan_day BETWEEN 0 AND 6);
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS spot_id UUID REFERENCES run_spots(id) ON DELETE SET NULL;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS area_label TEXT;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS area_lat DOUBLE PRECISION;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS area_lng DOUBLE PRECISION;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS planned_pace_to TEXT;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS updated_time_at TIMESTAMPTZ;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS previous_start_time TEXT;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS cancel_note TEXT;
ALTER TABLE run_meetups ADD COLUMN IF NOT EXISTS soon_notified_at TIMESTAMPTZ;

-- Squad runs from before this migration: the host's group.
UPDATE run_meetups m SET squad_id = a.group_id
  FROM athletes a WHERE a.id = m.host_athlete_id AND m.visibility = 'squad' AND m.squad_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_run_meetups_date_status ON run_meetups (date, status);

CREATE TABLE IF NOT EXISTS run_meetup_invites (
  meetup_id UUID NOT NULL REFERENCES run_meetups(id) ON DELETE CASCADE,
  -- No REFERENCES athletes: run_meetups already references athletes (host), and a second
  -- path through this junction makes every unhinted athletes↔run_meetups embed ambiguous
  -- (schemaEmbedAmbiguity.test.ts). lib/admin/purge-athlete.ts deletes these rows.
  athlete_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (meetup_id, athlete_id)
);

ALTER TABLE run_meetup_requests DROP CONSTRAINT IF EXISTS run_meetup_requests_status_check;
ALTER TABLE run_meetup_requests ADD CONSTRAINT run_meetup_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'waitlist', 'left'));
-- Waitlist order is created_at; a re-join after leaving re-queues, so it is reset on upsert.
CREATE INDEX IF NOT EXISTS idx_run_meetup_requests_status ON run_meetup_requests (meetup_id, status, created_at);

ALTER TABLE run_meetup_messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS run_meetup_activities (
  meetup_id UUID NOT NULL REFERENCES run_meetups(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES athlete_activities(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (meetup_id, activity_id)
);
CREATE INDEX IF NOT EXISTS idx_run_meetup_activities_activity ON run_meetup_activities (activity_id);

ALTER TABLE run_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_meetup_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_meetup_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages run spots" ON run_spots;
CREATE POLICY "Service role manages run spots" ON run_spots FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role manages run meetup invites" ON run_meetup_invites;
CREATE POLICY "Service role manages run meetup invites" ON run_meetup_invites FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role manages run meetup activities" ON run_meetup_activities;
CREATE POLICY "Service role manages run meetup activities" ON run_meetup_activities FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
