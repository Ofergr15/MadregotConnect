-- Grant the feed tab to `academy_user`.
--
-- Migration 036 enumerated roles by hand and missed this one, so members with the
-- academy_user role had no enabled row for 'feed' and the nav silently filtered the
-- tab out for them — the component is permission-driven, so a missing row reads as
-- "not allowed" rather than erroring.
--
-- academy_user is a member-flavoured role (it already has dashboard, activities,
-- races, program, practice, photos), so the club feed belongs there for the same
-- reason it does for runner.
--
-- `viewer` is deliberately still excluded: 036 set it to false explicitly, and the
-- feed is club-wide with full data per decision 1 in docs/feed-plan.md.

INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'feed', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'feed', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;
