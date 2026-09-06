-- הגרעין becomes a flag on the athlete row instead of a value in `role`.
--
-- WHY. `role = 'core_runner'` (migration 008) made one column answer two
-- unrelated questions:
--
--   role            → what may you DO      (admin / coach / academy_coach / runner / viewer)
--   is_core_runner  → are you IN the גרעין  (a membership tier, with its own sponsor perks)
--
-- In the real club those are orthogonal: a coach can be a core runner. With one
-- column they are not, so marking a coach as core demoted them out of staff —
-- and the club's designer and coaches are exactly the people most likely to be
-- in the גרעין. The same shape as migration 084's is_super_user/is_approver, for
-- the same reason: an entitlement that `role` cannot express.
--
-- WHAT THIS UNLOCKS BEYOND THE COEXISTENCE FIX:
--   * "who is in the גרעין" becomes one indexed boolean instead of a role scan.
--   * the 🌰 badge, the perks tier (club_perks.tier = 'core_runner', migration
--     070) and the athletes list all read one predicate — src/lib/core-runner.ts.
--   * the two role_tab_permissions rows for 'core_runner' (migration 008) keep
--     working untouched, because this migration does not change anybody's role.
--
-- ⚠️ NOTHING IS REVOKED. `role = 'core_runner'` is still honoured in code
-- (isCoreRunner() reads both), so this can be applied before or after the
-- deploy and in either order, and no athlete needs re-tagging by hand.

alter table athletes
  add column if not exists is_core_runner boolean not null default false;

comment on column athletes.is_core_runner is
  'In the club''s core squad (הגרעין): sees the club_perks rows with tier = ''core_runner''. Orthogonal to `role` — a coach or admin may also be a core runner. Supersedes role = ''core_runner'' (migration 008), which is still honoured for backwards compatibility.';

-- Seed from the legacy role so applying this changes nobody's access. Their role
-- is deliberately LEFT AS IS: rewriting it to 'runner' here would silently swap
-- their tab permissions (migration 008 gives core_runner its own set) in a
-- migration that is supposed to be additive. Converting a legacy row is a
-- decision for the management screen, one person at a time.
update athletes set is_core_runner = true where role = 'core_runner';

-- Partial index: read on the perks path and the profile badge, true for a
-- handful of rows. Same pattern as athletes_is_super_user_idx.
create index if not exists athletes_is_core_runner_idx on athletes (id) where is_core_runner;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--
--   -- Who is in, and how they are recorded:
--   SELECT name, email, role, is_core_runner FROM athletes
--    WHERE is_core_runner OR role = 'core_runner' ORDER BY role, name;
--
--   -- Rows still on the legacy role. These are the ones the management screen
--   -- offers to convert (role → 'runner', flag stays true), which is what lets
--   -- them hold a staff role later:
--   SELECT name, email FROM athletes WHERE role = 'core_runner';
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS athletes_is_core_runner_idx;
--   ALTER TABLE athletes DROP COLUMN IF EXISTS is_core_runner;
--   -- (safe: no athlete's `role` was modified, so the pre-091 behaviour returns)
-- ────────────────────────────────────────────────────────────────────────────
