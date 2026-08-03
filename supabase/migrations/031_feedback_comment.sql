-- Free-text comment on the post-workout questionnaire (PRD §1) — an open box for
-- the athlete to add anything beyond the structured difficulty/feel/pain answers.
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS comment TEXT;
