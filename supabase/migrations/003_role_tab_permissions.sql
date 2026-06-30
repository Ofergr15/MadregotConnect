-- Role-based tab permissions
CREATE TABLE role_tab_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role TEXT NOT NULL,
  tab TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, tab)
);

-- Seed default permissions
-- Admin gets all tabs
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'dashboard', true),
  ('admin', 'plan/new', true),
  ('admin', 'athletes', true),
  ('admin', 'groups', true),
  ('admin', 'program', true),
  ('admin', 'history', true),
  ('admin', 'settings', true),
  -- Coach gets all tabs
  ('coach', 'dashboard', true),
  ('coach', 'plan/new', true),
  ('coach', 'athletes', true),
  ('coach', 'groups', true),
  ('coach', 'program', true),
  ('coach', 'history', true),
  ('coach', 'settings', false),
  -- Runner gets limited tabs
  ('runner', 'dashboard', false),
  ('runner', 'plan/new', false),
  ('runner', 'athletes', false),
  ('runner', 'groups', false),
  ('runner', 'program', true),
  ('runner', 'history', false),
  ('runner', 'settings', false),
  -- Viewer gets minimal tabs
  ('viewer', 'dashboard', false),
  ('viewer', 'plan/new', false),
  ('viewer', 'athletes', false),
  ('viewer', 'groups', false),
  ('viewer', 'program', true),
  ('viewer', 'history', false),
  ('viewer', 'settings', false);
