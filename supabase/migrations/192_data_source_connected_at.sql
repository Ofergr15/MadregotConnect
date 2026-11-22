-- 192: when (and how) each data source was connected — the native "watch & data
-- sources" screen shows "מחובר מאז …" and whether Garmin came in through Garmin's
-- own sign-in page or the password fallback.
--
-- Written by /api/me/data-sources/garmin/{ticket,password} and the Strava callback's
-- native branch. Every reader and writer tolerates these columns being absent, so
-- this can be pasted in at any time. Hand-applied in the Supabase SQL editor.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS garmin_connected_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS garmin_connected_via TEXT
  CHECK (garmin_connected_via IS NULL OR garmin_connected_via IN ('sso', 'password'));
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_connected_at TIMESTAMPTZ;
