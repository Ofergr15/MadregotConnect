-- Admin-only tabs: Practice Attendance + Workout Feedback.
-- The nav renders a tab only if it has an enabled role_tab_permissions row, so
-- add rows for role='admin' only (these views are admin-only for now).
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'practice-attendance', true),
  ('admin', 'workout-feedback', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;
