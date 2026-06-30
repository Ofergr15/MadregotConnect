-- Add core_runner role with expanded permissions
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('core_runner', 'dashboard', true),
  ('core_runner', 'plan/new', true),
  ('core_runner', 'athletes', false),
  ('core_runner', 'groups', false),
  ('core_runner', 'activities', true),
  ('core_runner', 'races', true),
  ('core_runner', 'program', true),
  ('core_runner', 'history', true),
  ('core_runner', 'settings', false)
ON CONFLICT (role, tab) DO NOTHING;
