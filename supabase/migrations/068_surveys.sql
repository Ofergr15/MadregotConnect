-- Notification Center gap: every existing notification type is one-way
-- (push delivers a message, nothing collects a response). A survey is a
-- genuinely different kind — a question with options, sent as a
-- notification, that athletes answer in-app and the coach sees results for.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_he TEXT NOT NULL,
  question_en TEXT,
  options_he TEXT[] NOT NULL,
  options_en TEXT[],
  audience_type TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'group' | 'athlete' — mirrors scheduled_notifications
  audience_id UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at TIMESTAMPTZ                        -- optional; null = never closes
);

-- One response per athlete per survey — resubmitting updates the existing row.
CREATE TABLE IF NOT EXISTS survey_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  option_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(survey_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);

-- Links a scheduled_notifications row (kind='survey') to the survey it
-- announces, so the Notification Center's list can offer "View results"
-- directly from the existing notification list without a second lookup.
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS survey_id UUID REFERENCES surveys(id) ON DELETE SET NULL;

ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages surveys" ON surveys;
CREATE POLICY "Service role manages surveys"
  ON surveys FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages survey responses" ON survey_responses;
CREATE POLICY "Service role manages survey responses"
  ON survey_responses FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
