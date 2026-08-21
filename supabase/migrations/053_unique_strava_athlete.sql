-- One Madregot athlete row per Strava account. This makes OAuth callbacks
-- idempotent and prevents concurrent/repeated logins creating duplicate users.
CREATE UNIQUE INDEX IF NOT EXISTS idx_athletes_strava_athlete_unique
  ON athletes (strava_athlete_id)
  WHERE strava_athlete_id IS NOT NULL;
