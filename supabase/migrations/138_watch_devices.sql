-- Apple Watch, Phase 0: devices, device credentials, and provider-aware
-- deliveries and activities. Nothing writes to any of this until the companion
-- iPhone app registers a device; every reader feature-detects it
-- (lib/watch/schema.ts), so the code is safe to deploy before this is pasted.
--
-- athlete_devices  one row per installed companion app. revoked_at ends it.
-- device_tokens    sha256 of each refresh token (never the token), rotated on
--                  use; replaced_by chains a token to its successor so reuse of
--                  an exchanged token can be detected (lib/watch/device-auth.ts).
-- workout_deliveries.provider          'garmin' for every existing row (default).
-- workout_deliveries.provider_plan_id  the UUID given to WorkoutPlan(_:id:) and
--                                      read back off HKWorkout.workoutPlan.
-- workout_deliveries.superseded_at /   a re-push with changed content retires
--                    removed_at        the old row; the phone acks removal.
-- workout_key / device_confirmed_at    came in 092; repeated IF NOT EXISTS.
-- athlete_activities.apple_workout_uuid HKWorkout.uuid — the upload's
--                                      idempotency key, unique per athlete.
-- athlete_activities.provider_plan_id  the plan id the run was started from.
-- activity_plan_matches 'apple_workout' the exact match, ranked like
--                                      'garmin_workout'.
-- athlete_activities.source is unconstrained TEXT, so 'apple' needs no change.
--
-- Same lock-down as 134/135: RLS on, nothing for anon/authenticated.

CREATE TABLE IF NOT EXISTS athlete_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios')),
  installation_id TEXT,
  device_name TEXT,
  app_version TEXT,
  os_version TEXT,
  apns_token TEXT,
  scheduler_authorized BOOLEAN NOT NULL DEFAULT false,
  health_authorized BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_athlete_devices_live
  ON athlete_devices (athlete_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_athlete_devices_installation
  ON athlete_devices (athlete_id, installation_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES athlete_devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  replaced_by UUID,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens (device_id);
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'garmin';
ALTER TABLE workout_deliveries DROP CONSTRAINT IF EXISTS workout_deliveries_provider_check;
ALTER TABLE workout_deliveries ADD CONSTRAINT workout_deliveries_provider_check
  CHECK (provider IN ('garmin', 'apple'));
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS provider_plan_id UUID;
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS workout_key TEXT;
ALTER TABLE workout_deliveries ADD COLUMN IF NOT EXISTS device_confirmed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_deliveries_provider_plan
  ON workout_deliveries (provider_plan_id) WHERE provider_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workout_deliveries_apple_live
  ON workout_deliveries (athlete_id, workout_date)
  WHERE provider = 'apple' AND superseded_at IS NULL;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS apple_workout_uuid UUID;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS provider_plan_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_athlete_activities_apple_workout
  ON athlete_activities (athlete_id, apple_workout_uuid) WHERE apple_workout_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_athlete_activities_provider_plan
  ON athlete_activities (provider_plan_id) WHERE provider_plan_id IS NOT NULL;
ALTER TABLE activity_plan_matches
  DROP CONSTRAINT IF EXISTS activity_plan_matches_match_method_check;
ALTER TABLE activity_plan_matches
  ADD CONSTRAINT activity_plan_matches_match_method_check
  CHECK (match_method IN ('auto', 'manual', 'garmin_workout', 'apple_workout'));
ALTER TABLE athlete_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE athlete_devices FROM anon, authenticated;
REVOKE ALL ON TABLE device_tokens FROM anon, authenticated;
GRANT ALL ON TABLE athlete_devices TO service_role;
GRANT ALL ON TABLE device_tokens TO service_role;
NOTIFY pgrst, 'reload schema';
