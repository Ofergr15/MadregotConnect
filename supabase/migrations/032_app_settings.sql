-- Simple key/value app settings. First use: the maintenance ("under renovation")
-- toggle. `maintenance_mode` = 'on' hides the whole app from everyone except the
-- approver allowlist; 'off' (or missing) = normal.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('maintenance_mode', 'off')
ON CONFLICT (key) DO NOTHING;
