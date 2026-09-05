-- ═══════════════════════════════════════════════════════════════════════════
-- 087 — Grant the races tab to `viewer`
--
-- Migration 006 seeded this pair and prod does not have it: neither
-- `role_tab_permissions` nor `role_mobile_tab_permissions` has a
-- ('viewer', 'races') row at all. A missing row reads as "not allowed" (same bug
-- class as migrations 048 and 065), so viewers can't see the races tab and
-- nothing in the Tab Manager shows why — the row isn't there to toggle.
--
-- Confirmed against prod before writing this: viewer has 12 dashboard rows and 3
-- mobile ones, and `races` is in neither list. Enabling both, so the tab behaves
-- the same on a phone as in the dashboard.
--
-- Apply manually in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('viewer', 'races', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('viewer', 'races', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;
