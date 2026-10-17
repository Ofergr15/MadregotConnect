-- "מתאמן אצלנו מאז" — when a trainee started in the academy BEFORE the app (the migration
-- path: existing trainees moved in without the funnel, mockup academy-existing-add).
--
-- Its own column on purpose, NOT academy_joined_on: joined_on is the day they joined the APP's
-- academy, and it drives the weekly grading (days before it are not graded), the trainee home's
-- journey, the trends' "joined this week" and the payments module's "coached for free" clock.
-- Backdating it would grade weeks that were never planned here and turn payments red at once.
-- This one is for display and seniority only.
--
-- OPTIONAL until pasted: the move-in writes it when the column exists and skips it otherwise.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS academy_training_since DATE;
