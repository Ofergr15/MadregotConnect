-- Admin/coach-only tab: Team Volume (per-athlete weekly-volume overview from
-- weekly_km_snapshots). The nav renders a tab only if it has an enabled
-- role_tab_permissions row, so add rows for the staff roles.
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'team-volume', true),
  ('coach', 'team-volume', true),
  ('academy_coach', 'team-volume', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;
