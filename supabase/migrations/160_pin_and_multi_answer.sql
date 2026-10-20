-- 160: a feed post pinned to the top until a time, and surveys with more than one answer.
-- Paste as one block in the Supabase SQL editor; safe to run twice.
ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS pinned_until timestamptz;
CREATE INDEX IF NOT EXISTS idx_feed_items_pinned ON feed_items (pinned_until DESC) WHERE pinned_until IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS multi_answer boolean NOT NULL DEFAULT false;
ALTER TABLE survey_responses DROP CONSTRAINT IF EXISTS survey_responses_survey_id_athlete_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_survey_athlete_option_key ON survey_responses (survey_id, athlete_id, option_index);
