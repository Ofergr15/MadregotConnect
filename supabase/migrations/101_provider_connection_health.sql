-- Provider connection health.
--
-- Until now the profile screen's "Connected" pill meant exactly one thing:
-- `garmin_auth`/`strava_auth` is not null. That value changes only when somebody
-- connects, and nothing in the app ever cleared it — so a revoked Strava
-- authorization, a changed Garmin password or an expired token rendered
-- "Connected" forever, with no way for the athlete (or a coach) to tell.
--
-- These four columns are the two facts the pill actually needs: when the last
-- sync succeeded, and whether the credential has since been rejected.
--
-- No backfill. NULL `*_last_sync_at` means "not stamped yet", which the UI shows
-- as plain "Connected" — the same thing it said before — rather than alarming
-- everyone the moment this deploys. The hourly sync crons stamp every connected
-- athlete within the hour, and the pill starts telling the truth from then on.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS garmin_last_sync_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS garmin_auth_failed_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_last_sync_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS strava_auth_failed_at TIMESTAMPTZ;

COMMENT ON COLUMN athletes.garmin_last_sync_at IS 'Last time a Garmin sync fetched this athlete''s activity list successfully (0 new runs still counts).';
COMMENT ON COLUMN athletes.garmin_auth_failed_at IS 'Last time Garmin rejected the stored credential. Cleared on the next successful sync.';
COMMENT ON COLUMN athletes.strava_last_sync_at IS 'Last time a Strava sync fetched this athlete''s activity list successfully.';
COMMENT ON COLUMN athletes.strava_auth_failed_at IS 'Last time a Strava token refresh was refused. Cleared on the next successful sync.';
