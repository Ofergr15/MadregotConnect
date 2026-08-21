-- Strava rows used garmin_activity_id = -1 as a shared sentinel, but
-- UNIQUE(athlete_id, garmin_activity_id) only allows one such row per athlete.
-- Remap existing Strava rows to -strava_activity_id (negative Strava id space).

UPDATE athlete_activities
SET garmin_activity_id = -strava_activity_id
WHERE source = 'strava'
  AND strava_activity_id IS NOT NULL
  AND garmin_activity_id = -1;
