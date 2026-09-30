ALTER TABLE academy_candidates ADD COLUMN IF NOT EXISTS invite_token text;
ALTER TABLE academy_candidates ADD COLUMN IF NOT EXISTS invited_at timestamptz;
ALTER TABLE academy_candidates ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS academy_candidates_invite_token_idx ON academy_candidates (invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS academy_candidates_email_idx ON academy_candidates (email) WHERE email IS NOT NULL;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS candidate_id uuid;
CREATE INDEX IF NOT EXISTS email_log_candidate_idx ON email_log (candidate_id, created_at DESC) WHERE candidate_id IS NOT NULL;
