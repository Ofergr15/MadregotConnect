-- Onboarding v2: sign in with a 6-digit code sent to the member's email, for the
-- members who have no Strava (until now there was no way in for them at all).
-- The code itself is never stored, only its HMAC; attempts are counted so a
-- code cannot be guessed. Read and written only by the service role.
CREATE TABLE IF NOT EXISTS login_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS login_codes_email_idx ON login_codes (email, created_at DESC);
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;
