-- 165_athlete_auth_presence.sql
--
-- "Is this member connected?" without reading the credential itself. garmin_auth is
-- an encrypted session blob (~93 KB across the club's rows today); 34 routes selected
-- it only to turn it into a boolean, which made a member list 2.3 s instead of 0.5 s
-- (measured 2026-10-20). Generated columns: always in step with the credential, nothing
-- to keep in sync in code.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS has_garmin boolean GENERATED ALWAYS AS (garmin_auth IS NOT NULL) STORED;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS has_strava boolean GENERATED ALWAYS AS (strava_auth IS NOT NULL) STORED;
NOTIFY pgrst, 'reload schema';
