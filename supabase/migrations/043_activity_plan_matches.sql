-- Persist the exact published workout part used by each recorded activity.
-- One activity has one match, and one athlete can record a published part once.
CREATE TABLE IF NOT EXISTS activity_plan_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES athlete_activities(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  weekly_plan_id UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  workout_key TEXT NOT NULL,
  group_number SMALLINT NOT NULL DEFAULT 2 CHECK (group_number BETWEEN 1 AND 3),
  match_method TEXT NOT NULL DEFAULT 'auto' CHECK (match_method IN ('auto', 'manual')),
  score NUMERIC(5,2),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  overridden_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id),
  UNIQUE (athlete_id, weekly_plan_id, workout_key)
);

CREATE INDEX IF NOT EXISTS idx_activity_plan_matches_plan
  ON activity_plan_matches (weekly_plan_id, workout_key);

CREATE INDEX IF NOT EXISTS idx_activity_plan_matches_athlete
  ON activity_plan_matches (athlete_id, created_at DESC);

ALTER TABLE activity_plan_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages activity plan matches" ON activity_plan_matches;
CREATE POLICY "Service role manages activity plan matches"
  ON activity_plan_matches FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
