-- Per-user notification preferences: which CATEGORIES of push an athlete wants.
-- JSONB map of category → boolean; a missing key (or missing column, pre-migration)
-- means opted-IN, so the default is "receive everything" and nothing is lost.
-- Categories: workouts | coach | achievements | program.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS notification_prefs JSONB;
