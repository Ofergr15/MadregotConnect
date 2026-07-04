CREATE TABLE IF NOT EXISTS role_mobile_tab_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role TEXT NOT NULL,
  tab TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, tab)
);

-- Default mobile tabs: runners see program, practice, activities, races
INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'dashboard', true),
  ('admin', 'athletes', true),
  ('admin', 'activities', true),
  ('admin', 'program', true),
  ('admin', 'practice', true),
  ('admin', 'races', true),
  ('admin', 'settings', true),
  ('coach', 'dashboard', true),
  ('coach', 'athletes', true),
  ('coach', 'activities', true),
  ('coach', 'program', true),
  ('coach', 'practice', true),
  ('coach', 'races', true),
  ('runner', 'program', true),
  ('runner', 'practice', true),
  ('runner', 'activities', true),
  ('runner', 'races', true),
  ('core_runner', 'dashboard', true),
  ('core_runner', 'program', true),
  ('core_runner', 'practice', true),
  ('core_runner', 'activities', true),
  ('core_runner', 'races', true),
  ('viewer', 'program', true),
  ('viewer', 'practice', true)
ON CONFLICT (role, tab) DO NOTHING;
