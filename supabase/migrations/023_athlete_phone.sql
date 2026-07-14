-- Academy self-registration intake.
-- phone: promoted to a column (used elsewhere). academy_intake: the full
-- questionnaire (goal, group preference, medical history, shirt size, etc.) as JSON.
-- (onboarding_status is TEXT and reuses a new 'academy_pending' value — no schema change.)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS academy_intake JSONB;
