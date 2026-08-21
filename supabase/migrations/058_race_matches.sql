-- Race-count analytic (roadmap #20). Records which of an athlete's activities
-- are races, auto-matched against the calendar's `events` rows (kind='race')
-- by same-day date proximity, with manual tagging/correction on top.
--
-- Mirrors the exact match_method: 'auto'|'manual' pattern from
-- supabase/migrations/054_activity_plan_matches.sql — see that file first if
-- this shape looks unfamiliar. One row per race activity (presence = "this
-- activity is a race"); `is_race` lets a manual correction record "actually
-- NOT a race" without deleting the row, so a later auto-recompute pass (which
-- only skips activities that already have a manual row) doesn't silently
-- re-tag it.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS race_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES athlete_activities(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- Nullable: a manually-tagged race may have no corresponding calendar event
  -- (nobody entered it into /dashboard/calendar), or the event was deleted.
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  is_race BOOLEAN NOT NULL DEFAULT true,
  match_method TEXT NOT NULL DEFAULT 'auto' CHECK (match_method IN ('auto', 'manual')),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  overridden_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id)
);

CREATE INDEX IF NOT EXISTS idx_race_matches_athlete
  ON race_matches (athlete_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_race_matches_event
  ON race_matches (event_id);

ALTER TABLE race_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages race matches" ON race_matches;
CREATE POLICY "Service role manages race matches"
  ON race_matches FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
