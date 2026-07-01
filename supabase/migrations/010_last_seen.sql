-- Track when user last accessed the app
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Set current time for existing active users
UPDATE athletes SET last_seen_at = NOW() WHERE status = 'active';
