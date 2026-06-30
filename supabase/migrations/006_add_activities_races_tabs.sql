-- Add activities and races tabs to role permissions
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'activities', true),
  ('admin', 'races', true),
  ('coach', 'activities', true),
  ('coach', 'races', true),
  ('runner', 'activities', true),
  ('runner', 'races', true),
  ('viewer', 'activities', false),
  ('viewer', 'races', false)
ON CONFLICT (role, tab) DO NOTHING;
