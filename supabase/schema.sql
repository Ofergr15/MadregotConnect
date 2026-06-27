-- MadregotConnect Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types
CREATE TYPE athlete_status AS ENUM ('active', 'invited', 'disconnected');
CREATE TYPE plan_status AS ENUM ('draft', 'pushed', 'partial');
CREATE TYPE delivery_status AS ENUM ('pending', 'success', 'failed');

-- Coaches table
CREATE TABLE coaches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Groups table
CREATE TABLE groups (
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

-- Athletes table
CREATE TABLE athletes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  garmin_auth JSONB,
  status athlete_status DEFAULT 'invited',
  invite_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weekly plans table
CREATE TABLE weekly_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  original_input TEXT,
  parsed_workouts JSONB NOT NULL,
  status plan_status DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workout deliveries table
CREATE TABLE workout_deliveries (
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

-- Indexes
CREATE INDEX idx_athletes_invite_token ON athletes(invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX idx_athletes_coach_id ON athletes(coach_id);
CREATE INDEX idx_groups_coach_id ON groups(coach_id);
CREATE INDEX idx_weekly_plans_coach_week ON weekly_plans(coach_id, week_start_date);
CREATE INDEX idx_workout_deliveries_plan ON workout_deliveries(plan_id);
CREATE INDEX idx_workout_deliveries_athlete ON workout_deliveries(athlete_id);

-- Row Level Security
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_deliveries ENABLE ROW LEVEL SECURITY;

-- RLS Policies (coaches can only access their own data)
CREATE POLICY "Coaches can view own profile"
  ON coaches FOR SELECT USING (id = auth.uid());

CREATE POLICY "Coaches can update own profile"
  ON coaches FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Coaches can manage own groups"
  ON groups FOR ALL USING (coach_id = auth.uid());

CREATE POLICY "Coaches can manage own athletes"
  ON athletes FOR ALL USING (coach_id = auth.uid());

CREATE POLICY "Coaches can manage own plans"
  ON weekly_plans FOR ALL USING (coach_id = auth.uid());

CREATE POLICY "Coaches can manage own deliveries"
  ON workout_deliveries FOR ALL
  USING (
    athlete_id IN (SELECT id FROM athletes WHERE coach_id = auth.uid())
  );
