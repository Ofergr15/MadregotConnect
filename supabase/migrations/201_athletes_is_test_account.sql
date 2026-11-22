-- NOT APPLIED — paste manually when approved.
--
-- Flags a synthetic QA athlete (e.g. a +importNN plus-address). Its writes stay
-- visible to itself and to staff, but are hidden from other members' feed and
-- from leaderboards/standings, and never notify other people.
-- Code reads it through src/lib/athletes/test-accounts.ts, which fails open
-- (empty set) while this column is missing.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false;
