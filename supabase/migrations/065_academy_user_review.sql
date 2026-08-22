-- Grant the review (app feedback) tab to `academy_user`.
--
-- academy_user's tab list matches `runner`'s for every other member-flavoured
-- tab (dashboard, activities, races, program, practice, photos, feed — the
-- last one fixed by migration 048 for exactly this same silent-gap reason),
-- but was missing 'review'. No prior migration excludes it on purpose (unlike
-- the 'academy' admin tab, which migration 022 explicitly excludes with a
-- comment) — this is the same missing-row-reads-as-"not allowed" bug class.

INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'review', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'review', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;
