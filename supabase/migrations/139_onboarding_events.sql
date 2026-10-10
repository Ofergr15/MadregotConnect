CREATE TABLE IF NOT EXISTS onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  signup_request_id uuid REFERENCES signup_requests(id) ON DELETE SET NULL,
  step text NOT NULL,
  device text,
  platform text,
  standalone boolean,
  app_version text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS onboarding_events_athlete_idx ON onboarding_events (athlete_id, created_at);
CREATE INDEX IF NOT EXISTS onboarding_events_signup_idx ON onboarding_events (signup_request_id, created_at);
CREATE INDEX IF NOT EXISTS onboarding_events_step_idx ON onboarding_events (step, created_at);
ALTER TABLE onboarding_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onboarding_events FROM anon, authenticated;
