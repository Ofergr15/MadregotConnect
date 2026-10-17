-- The goal module (mockup academy-existing-add/goal-module.html): a goal is a RACE — one of
-- the club's own (an `events` row), or any race anywhere, with its distance, its place, and a
-- day that may not be fixed yet — plus, once it has been run, how it went.
--
-- event_id: the club race this goal is, so a race that moves on the calendar moves the goal
--   with it. No FK on purpose: an event deleted from the calendar must not delete or null a
--   trainee's goal silently; the read falls back to target_race / target_race_date.
-- distance_km: what is being run. goal_type stays as the coarse kind ('full', 'half', '10k',
--   '5k', 'other' for any other distance, or a no-race focus) for every reader that has only
--   ever known it.
-- date_is_estimate: "עוד לא סגור" — the trainee knows the month, not the day.
-- result_*: the race has been run. result_activity_id carries no FK for the same reason as
--   updated_by in 144 (a second key into a table that embeds athletes makes embeds ambiguous).
--
-- OPTIONAL until pasted: every read and write in lib/academy/goal-server.ts falls back to the
-- 144 columns when these are missing, so the module degrades to the old goal, it never breaks.

ALTER TABLE academy_goals
  ADD COLUMN IF NOT EXISTS event_id UUID,
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC(6,2) CHECK (distance_km IS NULL OR (distance_km > 0 AND distance_km <= 400)),
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS date_is_estimate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result_sec INTEGER CHECK (result_sec IS NULL OR (result_sec >= 600 AND result_sec <= 172800)),
  ADD COLUMN IF NOT EXISTS result_activity_id UUID,
  ADD COLUMN IF NOT EXISTS result_at TIMESTAMPTZ;
