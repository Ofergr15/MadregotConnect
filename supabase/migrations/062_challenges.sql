-- Phase 4 of the "missing parts" roadmap — Challenge System (#13, flagged
-- High Priority in the checklist). Builds on badges (059_badges.sql) exactly
-- as that migration's own header anticipated: completing a challenge is an
-- insert into `athlete_badges` against a `badges` row whose rule_type is
-- 'challenge_completed' (already accepted by that table's CHECK constraint,
-- unused until now) — so a completed challenge inherits the feed post + push
-- for free via the existing awardBadge() helper. `challenges` itself only
-- adds what badges doesn't have: a metric to track LIVE progress against and
-- a start/end window.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- The reward: a badges row with rule_type='challenge_completed'. Created
  -- together with this row (see POST /api/admin/challenges) — never shared
  -- between two challenges, so ON DELETE CASCADE from either side is safe.
  badge_id UUID NOT NULL UNIQUE REFERENCES badges(id) ON DELETE CASCADE,
  name_he TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_he TEXT,
  description_en TEXT,
  metric TEXT NOT NULL CHECK (metric IN ('distance_km', 'workout_count', 'elevation_m')),
  target_value NUMERIC NOT NULL CHECK (target_value > 0),
  -- 'individual': every athlete's own activities count toward their own
  -- progress. 'group': every pace-group's members' activities are pooled —
  -- ALL groups race toward the same target independently; whichever group(s)
  -- cross it first get every member awarded (see lib/challenges/engine.ts).
  scope TEXT NOT NULL DEFAULT 'individual' CHECK (scope IN ('individual', 'group')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  created_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_window ON challenges (active, start_date, end_date);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages challenges" ON challenges;
CREATE POLICY "Service role manages challenges"
  ON challenges FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
