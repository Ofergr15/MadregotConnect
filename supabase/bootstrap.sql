-- ============================================================
-- MadregotConnect Bootstrap SQL
-- Paste this ONCE into the Supabase SQL Editor on a fresh project.
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- ============================================================
-- Combines:
--   • Base schema  (schema.sql)
--   • Migrations 001–025
--   • Revised migration 026 (run_photos + detected_faces + athlete_faces)
--   • Storage buckets (program-plans, face-crops, reference-faces)
--   • Seed: coach, 3 groups, shaharglazner@gmail.com as admin
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types (wrapped to survive re-runs)
DO $$ BEGIN CREATE TYPE athlete_status AS ENUM ('active', 'invited', 'disconnected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE plan_status AS ENUM ('draft', 'pushed', 'partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE delivery_status AS ENUM ('pending', 'success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── COACHES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'coach';

-- ─── GROUPS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pace_profile JSONB NOT NULL DEFAULT '{
    "easy": {"min": 330, "max": 390},
    "threshold": {"min": 270, "max": 290},
    "interval": {"min": 240, "max": 260},
    "tempo": {"min": 280, "max": 300},
    "sprint": {"min": 200, "max": 230},
    "marathon_pace": {"min": 290, "max": 310}
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ATHLETES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS athletes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  -- UNIQUE: matches prod, and the sign-in route's `onConflict: 'email'` upsert
  -- needs it. Migration 079 adds it to databases created before this line.
  email TEXT NOT NULL UNIQUE,
  garmin_auth JSONB,
  status athlete_status DEFAULT 'invited',
  invite_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- migration 004
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'runner';
-- migration 009
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'pending';
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS google_authed_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS garmin_authed_at TIMESTAMPTZ;
-- migration 010
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
-- migration 013
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_auth JSONB;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'garmin';
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_athlete_id BIGINT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_enabled BOOLEAN DEFAULT false;
-- migration 019
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS is_academy BOOLEAN NOT NULL DEFAULT false;
-- migration 023
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS academy_intake JSONB;

-- ─── WEEKLY PLANS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  original_input TEXT,
  parsed_workouts JSONB NOT NULL,
  status plan_status DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- migration 019
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_weekly_plans_athlete_id ON weekly_plans(athlete_id);

-- ─── WORKOUT DELIVERIES ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID REFERENCES weekly_plans(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  workout_date DATE NOT NULL,
  workout_data JSONB NOT NULL,
  garmin_workout_id TEXT,
  status delivery_status DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ATHLETE ACTIVITIES ──────────────────────────────────────────────────────
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
-- migration 005
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
-- migration 013
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'garmin';
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS strava_activity_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_strava_unique
  ON athlete_activities(athlete_id, strava_activity_id)
  WHERE strava_activity_id IS NOT NULL;
-- migration 018
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS gps_points JSONB;
-- migration 024
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS laps JSONB;

-- ─── RACES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS races (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  location TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  distances TEXT[] NOT NULL DEFAULT '{}',
  type TEXT NOT NULL DEFAULT 'half',
  website TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FEEDBACK ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,
  athlete_name TEXT NOT NULL,
  athlete_email TEXT,
  group_name TEXT,
  message TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  status TEXT DEFAULT 'new',
  priority TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ─── WEEKLY KM SNAPSHOTS ─────────────────────────────────────────────────────
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

-- ─── PROGRAM WEEKS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_weeks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_number INTEGER NOT NULL,
  date_range TEXT NOT NULL,
  week_start_date DATE NOT NULL,
  training_pdf_url TEXT,
  nutrition_pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_start_date)
);

-- ─── ACADEMY WORKOUTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_workouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  workout JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BENCHMARK RESULTS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS benchmark_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL DEFAULT '2000m',
  athlete_name TEXT NOT NULL,
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  time_seconds NUMERIC NOT NULL,
  notes TEXT,
  recorded_on DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE benchmark_results ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE benchmark_results ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE benchmark_results ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- ─── ACADEMY SETTINGS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_settings (
  coach_id UUID PRIMARY KEY REFERENCES coaches(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ROLE TAB PERMISSIONS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_tab_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role TEXT NOT NULL,
  tab TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, tab)
);

CREATE TABLE IF NOT EXISTS role_mobile_tab_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role TEXT NOT NULL,
  tab TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, tab)
);

-- ─── PHOTOS + FACE RECOGNITION (migration 026, revised) ──────────────────────
-- Full redesign: photo_tags and athletes.rekognition_face_id dropped.
-- detected_faces IS the tag table. athlete_faces holds enrolled references.

CREATE TABLE IF NOT EXISTS run_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES coaches(id),
  drive_file_id TEXT NOT NULL UNIQUE,
  drive_url TEXT NOT NULL,
  thumbnail_url TEXT,
  filename TEXT,
  taken_at TIMESTAMPTZ,
  run_date DATE NOT NULL,
  width INTEGER,
  height INTEGER,
  faces_detected INTEGER,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detected_faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES run_photos(id) ON DELETE CASCADE,
  bounding_box JSONB,          -- {left, top, width, height} 0-1 relative
  crop_url TEXT,               -- public face-crops bucket URL
  rekognition_face_id TEXT,
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  confidence NUMERIC,          -- similarity 0-100; NULL = manual tag
  source TEXT DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS athlete_faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  rekognition_face_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('selfie', 'coach_label')),
  source_face_id UUID REFERENCES detected_faces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_athlete_activities_athlete  ON athlete_activities(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_activities_start    ON athlete_activities(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_athletes_invite_token       ON athletes(invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_athletes_coach_id           ON athletes(coach_id);
CREATE INDEX IF NOT EXISTS idx_groups_coach_id             ON groups(coach_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_coach_week     ON weekly_plans(coach_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_workout_deliveries_plan     ON workout_deliveries(plan_id);
CREATE INDEX IF NOT EXISTS idx_workout_deliveries_athlete  ON workout_deliveries(athlete_id);
CREATE INDEX IF NOT EXISTS idx_weekly_km_week              ON weekly_km_snapshots(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_km_group_week        ON weekly_km_snapshots(group_id, week_start);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_coach_test ON benchmark_results(coach_id, test_name);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_athlete   ON benchmark_results(athlete_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_status    ON benchmark_results(coach_id, test_name, status);
CREATE INDEX IF NOT EXISTS idx_program_weeks_start         ON program_weeks(week_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_academy_workouts_coach      ON academy_workouts(coach_id);
CREATE INDEX IF NOT EXISTS idx_run_photos_run_date         ON run_photos(run_date);
CREATE INDEX IF NOT EXISTS idx_run_photos_unprocessed      ON run_photos(id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_detected_faces_photo_id     ON detected_faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_detected_faces_athlete_id   ON detected_faces(athlete_id);
CREATE INDEX IF NOT EXISTS idx_detected_faces_unidentified ON detected_faces(id) WHERE athlete_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_athlete_faces_athlete_id    ON athlete_faces(athlete_id);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────
-- The app uses service-role for all API routes, which bypasses RLS. Keeping
-- RLS enabled as a safety net against accidental anon-key exposure.
ALTER TABLE coaches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE athletes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_activities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_km_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_photos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE detected_faces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_faces         ENABLE ROW LEVEL SECURITY;

-- Basic policies so service-role isn't blocked by "no policy allows this"
-- (service_role bypasses RLS, but anon/authenticated keys need explicit policies)
DO $$ BEGIN CREATE POLICY "Coaches: own profile select" ON coaches FOR SELECT USING (id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Coaches: own profile update" ON coaches FOR UPDATE USING (id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Coaches: own groups" ON groups FOR ALL USING (coach_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Coaches: own athletes" ON athletes FOR ALL USING (coach_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Coaches: own plans" ON weekly_plans FOR ALL USING (coach_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Coaches: own deliveries" ON workout_deliveries FOR ALL USING (athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Coaches: own activities" ON athlete_activities FOR ALL USING (athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Coaches: own km snapshots" ON weekly_km_snapshots FOR ALL USING (athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── STORAGE BUCKETS ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('program-plans', 'program-plans', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('face-crops', 'face-crops', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('reference-faces', 'reference-faces', false)
ON CONFLICT (id) DO NOTHING;

-- Storage object policies
DO $$ BEGIN
  CREATE POLICY "program-plans: public read"
    ON storage.objects FOR SELECT USING (bucket_id = 'program-plans');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "program-plans: service write"
    ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'program-plans');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "program-plans: service update"
    ON storage.objects FOR UPDATE USING (bucket_id = 'program-plans');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "face-crops: public read"
    ON storage.objects FOR SELECT USING (bucket_id = 'face-crops');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "face-crops: service write"
    ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'face-crops');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "face-crops: service delete"
    ON storage.objects FOR DELETE USING (bucket_id = 'face-crops');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "reference-faces: service all"
    ON storage.objects FOR ALL USING (bucket_id = 'reference-faces');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── SEED DATA ───────────────────────────────────────────────────────────────
-- Coach row — COACH_ID must match src/lib/constants.ts
INSERT INTO coaches (id, email, name, role) VALUES
  ('30f056a7-c651-490e-8356-615ea9eff097', 'madregot.club@gmail.com', 'Ofer Grosfeld', 'admin')
ON CONFLICT (id) DO NOTHING;

-- Three pace groups (Group 1 = fast/green, 2 = medium/yellow, 3 = slow/orange)
INSERT INTO groups (coach_id, name) VALUES
  ('30f056a7-c651-490e-8356-615ea9eff097', 'קבוצה 1'),
  ('30f056a7-c651-490e-8356-615ea9eff097', 'קבוצה 2'),
  ('30f056a7-c651-490e-8356-615ea9eff097', 'קבוצה 3')
ON CONFLICT DO NOTHING;

-- Demo admin — can run the full import+selfie flow
INSERT INTO athletes (coach_id, name, email, status, role, approved, onboarding_status) VALUES
  ('30f056a7-c651-490e-8356-615ea9eff097', 'Shahar Glazner', 'shaharglazner@gmail.com', 'active', 'admin', true, 'active')
ON CONFLICT DO NOTHING;

-- Upcoming races
INSERT INTO races (name, date, location, lat, lng, distances, type, website) VALUES
  ('5 ק"מ הרצליה',        '2026-09-04', 'הרצליה',                    32.1628,  34.7896, ARRAY['5km'],                      '5k',       NULL),
  ('מרוץ פארק הירקון',    '2026-10-09', 'תל אביב, פארק הירקון',       32.0971,  34.8072, ARRAY['21.1km', '10km'],           'half',     NULL),
  ('חצי מרתון עמק החולה', '2026-10-30', 'עמק החולה',                  33.0667,  35.6000, ARRAY['21.1km', '10km'],           'half',     NULL),
  ('מרוץ אייל',           '2026-11-14', 'קיבוץ אייל, מרכז',           32.2100,  34.9797, ARRAY['21.1km', '10km'],           'half',     NULL),
  ('מרתון ולנסיה ''26',   '2026-12-06', 'Valencia, Spain',            39.4699,  -0.3763, ARRAY['42.2km', '21.1km', '10km'], 'marathon', 'https://www.valenciaciudaddelrunning.com')
ON CONFLICT DO NOTHING;

-- Program weeks seed (PDFs won't exist locally, entries are fine)
INSERT INTO program_weeks (week_number, date_range, week_start_date, training_pdf_url, nutrition_pdf_url) VALUES
  (1, '31.05 – 06.06', '2026-05-31', '/plans/training-program/week-31-05-06-06-2026.pdf', '/plans/nutrition-plan/week-31-05-06-06-2026.pdf'),
  (2, '07.06 – 13.06', '2026-06-07', '/plans/training-program/week-07-13-06-2026.pdf',    '/plans/nutrition-plan/week-07-13-06-2026.pdf'),
  (3, '14.06 – 20.06', '2026-06-14', '/plans/training-program/week-14-20-06-2026.pdf',    '/plans/nutrition-plan/week-14-20-06-2026.pdf'),
  (4, '21.06 – 27.06', '2026-06-21', '/plans/training-program/week-21-27-06-2026.pdf',    '/plans/nutrition-plan/week-21-27-06-2026.pdf'),
  (5, '28.06 – 04.07', '2026-06-28', '/plans/training-program/week-28-06-04-07-2026.pdf', '/plans/nutrition-plan/week-28-06-04-07-2026.pdf')
ON CONFLICT DO NOTHING;

-- ─── ROLE TAB PERMISSIONS ────────────────────────────────────────────────────

-- Core tabs (migration 003)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin',  'dashboard', true),  ('admin',  'plan/new', true),  ('admin',  'athletes', true),
  ('admin',  'groups',    true),  ('admin',  'program',  true),  ('admin',  'history',  true),
  ('admin',  'settings',  true),
  ('coach',  'dashboard', true),  ('coach',  'plan/new', true),  ('coach',  'athletes', true),
  ('coach',  'groups',    true),  ('coach',  'program',  true),  ('coach',  'history',  true),
  ('coach',  'settings',  false),
  ('runner', 'dashboard', false), ('runner', 'plan/new', false), ('runner', 'athletes', false),
  ('runner', 'groups',    false), ('runner', 'program',  true),  ('runner', 'history',  false),
  ('runner', 'settings',  false),
  ('viewer', 'dashboard', false), ('viewer', 'plan/new', false), ('viewer', 'athletes', false),
  ('viewer', 'groups',    false), ('viewer', 'program',  true),  ('viewer', 'history',  false),
  ('viewer', 'settings',  false)
ON CONFLICT (role, tab) DO NOTHING;

-- Activities + races (migrations 005, 006)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin',  'activities', true),  ('admin',  'races', true),
  ('coach',  'activities', true),  ('coach',  'races', true),
  ('runner', 'activities', true),  ('runner', 'races', true),
  ('viewer', 'activities', false), ('viewer', 'races', false)
ON CONFLICT (role, tab) DO NOTHING;

-- core_runner (migration 008)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('core_runner', 'dashboard',  true),  ('core_runner', 'plan/new',  true),
  ('core_runner', 'athletes',   false), ('core_runner', 'groups',    false),
  ('core_runner', 'activities', true),  ('core_runner', 'races',     true),
  ('core_runner', 'program',    true),  ('core_runner', 'history',   true),
  ('core_runner', 'settings',   false)
ON CONFLICT (role, tab) DO NOTHING;

-- Feedback/review (migration 011)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('runner',      'review', true),  ('core_runner', 'review', true),
  ('coach',       'review', false), ('admin',       'review', false)
ON CONFLICT (role, tab) DO NOTHING;

-- Academy (migration 019)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'academy', true),  ('coach',       'academy', true),
  ('core_runner', 'academy', false), ('runner', 'academy', false),
  ('viewer', 'academy', false)
ON CONFLICT (role, tab) DO NOTHING;

-- academy_user (migration 022)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'dashboard',  true),  ('academy_user', 'academy',   false),
  ('academy_user', 'activities', true),  ('academy_user', 'races',     true),
  ('academy_user', 'program',    true),  ('academy_user', 'practice',  true),
  ('academy_user', 'history',    false), ('academy_user', 'plan/new',  false),
  ('academy_user', 'athletes',   false), ('academy_user', 'groups',    false),
  ('academy_user', 'settings',   false)
ON CONFLICT (role, tab) DO NOTHING;

-- academy_coach (migration 025)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('academy_coach', 'dashboard',  true),  ('academy_coach', 'academy',  true),
  ('academy_coach', 'activities', true),  ('academy_coach', 'races',    true),
  ('academy_coach', 'program',    true),  ('academy_coach', 'practice', true),
  ('academy_coach', 'athletes',   false), ('academy_coach', 'groups',   false),
  ('academy_coach', 'plan/new',   false), ('academy_coach', 'history',  false),
  ('academy_coach', 'settings',   false)
ON CONFLICT (role, tab) DO NOTHING;

-- Photos (migration 026) — staff: all 4 tabs; athletes: My Photos only; viewers: hidden
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin',         'photos', true),
  ('coach',         'photos', true),
  ('academy_coach', 'photos', true),
  ('core_runner',   'photos', true),
  ('runner',        'photos', true),
  ('academy_user',  'photos', true),
  ('viewer',        'photos', false)
ON CONFLICT (role, tab) DO NOTHING;

-- ─── MOBILE TAB PERMISSIONS ──────────────────────────────────────────────────

-- Base (migration 014)
INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin',  'dashboard', true), ('admin',  'athletes',  true),  ('admin',  'activities', true),
  ('admin',  'program',   true), ('admin',  'practice',  true),  ('admin',  'races',      true),
  ('admin',  'settings',  true),
  ('coach',  'dashboard', true), ('coach',  'athletes',  true),  ('coach',  'activities', true),
  ('coach',  'program',   true), ('coach',  'practice',  true),  ('coach',  'races',      true),
  ('runner', 'program',   true), ('runner', 'practice',  true),  ('runner', 'activities', true),
  ('runner', 'races',     true),
  ('core_runner', 'dashboard', true), ('core_runner', 'program',    true),
  ('core_runner', 'practice',  true), ('core_runner', 'activities', true),
  ('core_runner', 'races',     true),
  ('viewer', 'program', true),   ('viewer', 'practice', true)
ON CONFLICT (role, tab) DO NOTHING;

-- Academy mobile (migration 019)
INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'academy', true), ('coach', 'academy', true)
ON CONFLICT (role, tab) DO NOTHING;

-- academy_user mobile (migration 022)
INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'dashboard',  true), ('academy_user', 'activities', true),
  ('academy_user', 'races',      true), ('academy_user', 'program',    true),
  ('academy_user', 'practice',   true)
ON CONFLICT (role, tab) DO NOTHING;

-- academy_coach mobile (migration 025)
INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('academy_coach', 'dashboard',  true), ('academy_coach', 'activities', true),
  ('academy_coach', 'races',      true), ('academy_coach', 'program',    true),
  ('academy_coach', 'practice',   true)
ON CONFLICT (role, tab) DO NOTHING;

-- Photos mobile (migration 026)
INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin',         'photos', true),
  ('coach',         'photos', true),
  ('academy_coach', 'photos', true),
  ('runner',        'photos', true),
  ('core_runner',   'photos', true),
  ('academy_user',  'photos', true),
  ('viewer',        'photos', false)
ON CONFLICT (role, tab) DO NOTHING;
