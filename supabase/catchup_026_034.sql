-- ============================================================================
-- CATCH-UP: migrations 026 through 034
--
-- These nine migrations were never applied to the live database (025 and earlier
-- are present; 035 and 036 are present). The gap surfaced as PostgREST errors on
-- the feed query — `athletes.avatar_url` (028) and `athlete_activities.perceived_rpe`
-- (026) don't exist — but it also silently breaks push notifications (027),
-- attendance (029), workout feedback (030/031), maintenance mode (032/033) and
-- program-week archiving (034).
--
-- Safe to run more than once: every statement is idempotent. The storage policies
-- from 028 are DROP-then-CREATE because Postgres has no CREATE POLICY IF NOT EXISTS.
--
-- Run this whole file in the Supabase SQL editor. Kept in the repo rather than
-- deleted after use: any other environment restored from a snapshot taken during
-- the gap needs the same catch-up, and `supabase/migrations/` alone won't reveal
-- that these were skipped.
-- ============================================================================

-- ---------------------------------------------------------------- 026
-- Garmin "Self Evaluation": Perceived Effort + How did it feel.
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS perceived_rpe NUMERIC;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS perceived_feel NUMERIC;

-- ---------------------------------------------------------------- 027
-- Notification Center: web-push subscriptions + admin-composed notifications.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_athlete ON push_subscriptions(athlete_id);

CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL DEFAULT 'custom',        -- 'custom' | 'training_before' | 'training_after'
  title_he TEXT NOT NULL,
  body_he TEXT NOT NULL,
  title_en TEXT,
  body_en TEXT,
  url TEXT NOT NULL DEFAULT '/dashboard',      -- deep link on click
  audience_type TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'group' | 'athlete'
  audience_id UUID,                            -- group_id or athlete_id (null for 'all')
  schedule_type TEXT NOT NULL DEFAULT 'now',   -- 'now' | 'once_at' | 'recurring'
  scheduled_at TIMESTAMPTZ,                     -- for 'once_at'
  recur_interval INT,                          -- e.g. 2
  recur_unit TEXT,                             -- 'day' | 'week'
  next_run_at TIMESTAMPTZ,                      -- driver column for the scanner
  status TEXT NOT NULL DEFAULT 'scheduled',    -- 'draft' | 'scheduled' | 'sent' | 'cancelled'
  last_sent_at TIMESTAMPTZ,
  sent_count INT NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due
  ON scheduled_notifications(status, next_run_at);

-- ---------------------------------------------------------------- 028
-- Profile photo (PRD §7), sourced from Google at login or uploaded manually.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS avatar_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read access for avatars" ON storage.objects;
CREATE POLICY "Public read access for avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Service role upload for avatars" ON storage.objects;
CREATE POLICY "Service role upload for avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Service role update for avatars" ON storage.objects;
CREATE POLICY "Service role update for avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');

-- ---------------------------------------------------------------- 029
-- Pre-workout attendance / RSVP (PRD §14).
CREATE TABLE IF NOT EXISTS workout_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  day_of_week INT NOT NULL,              -- 0=Sun .. 6=Sat
  attending BOOLEAN NOT NULL,            -- true = coming, false = not this time
  group_label TEXT,                      -- chosen דבוקה (e.g. 'דבוקה 2' or free text)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(athlete_id, week_start_date, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_workout_attendance_day
  ON workout_attendance(week_start_date, day_of_week);

-- ---------------------------------------------------------------- 030
-- Post-workout questionnaire (PRD §1).
CREATE TABLE IF NOT EXISTS workout_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  garmin_activity_id BIGINT,             -- the run this feedback is about (nullable for ad-hoc)
  difficulty INT,                        -- perceived difficulty 1..10
  feel INT,                              -- how did you feel 0..4 (weak..great)
  pain BOOLEAN,                          -- any pain / discomfort?
  pain_detail TEXT,                      -- optional description when pain = true
  wants_feedback BOOLEAN,                -- wants the coach to reach out?
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(athlete_id, garmin_activity_id)
);
CREATE INDEX IF NOT EXISTS idx_workout_feedback_athlete ON workout_feedback(athlete_id);
CREATE INDEX IF NOT EXISTS idx_workout_feedback_created ON workout_feedback(created_at DESC);

-- ---------------------------------------------------------------- 031
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS comment TEXT;

-- ---------------------------------------------------------------- 032
-- Key/value app settings; first use is the maintenance toggle.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('maintenance_mode', 'off')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- 033
-- Configurable workout-reminder schedule (admin-editable via Settings).
INSERT INTO app_settings (key, value) VALUES (
  'reminder_config',
  '{"teamDays":[2,5],"dayBefore":{"enabled":true,"hour":8},"eveningBefore":{"enabled":true,"hour":18}}'
) ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- 034
-- Weekly rollover: mark past program weeks archived.
ALTER TABLE program_weeks ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
