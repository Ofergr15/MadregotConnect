-- academy_coach role: runs the academy but not the whole club.
-- Sees the Academy tab + basics (dashboard/activities/races/program/practice).
-- NOT the club-wide athletes/groups/planner/history/settings.
-- (Admins can further adjust these in Settings → Tab Manager, which edits this table.)
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('academy_coach', 'dashboard', true),
  ('academy_coach', 'academy', true),
  ('academy_coach', 'activities', true),
  ('academy_coach', 'races', true),
  ('academy_coach', 'program', true),
  ('academy_coach', 'practice', true),
  ('academy_coach', 'athletes', false),
  ('academy_coach', 'groups', false),
  ('academy_coach', 'plan/new', false),
  ('academy_coach', 'history', false),
  ('academy_coach', 'settings', false)
ON CONFLICT (role, tab) DO NOTHING;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('academy_coach', 'dashboard', true),
  ('academy_coach', 'activities', true),
  ('academy_coach', 'races', true),
  ('academy_coach', 'program', true),
  ('academy_coach', 'practice', true)
ON CONFLICT (role, tab) DO NOTHING;
