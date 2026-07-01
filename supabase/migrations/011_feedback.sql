CREATE TABLE IF NOT EXISTS feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,
  athlete_name TEXT NOT NULL,
  athlete_email TEXT,
  group_name TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('runner', 'review', true),
  ('core_runner', 'review', true),
  ('coach', 'review', false),
  ('admin', 'review', false)
ON CONFLICT (role, tab) DO NOTHING;
