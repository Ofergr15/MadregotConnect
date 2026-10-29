-- Podium: group orders, per-person budgets, and how many orders a round expects (Ofer, 2026-10-29).
--
--   podium_orders.athlete_id      may be NULL now: a GROUP order ("אקסטרות") belongs to no runner
--   podium_orders.label           a group order's name ("אקסטרות — מלאי מועדון"); NULL on a runner's own
--   podium_orders.budget          a group order's own budget; NULL = the round's
--   podium_rounds.budgets         { athlete_id: amount } — this round's budget for these people, above
--                                 or below the round's default (the admin's "קרדיט")
--   podium_rounds.expected_count  how many orders the round should end with (15 of the core + 2 group = 17);
--                                 NULL = everyone the round is open to
--
-- UNIQUE (round_id, athlete_id) stays: one order per runner per round. NULLs are distinct in a
-- UNIQUE, so a round can hold several group orders.
ALTER TABLE podium_orders ALTER COLUMN athlete_id DROP NOT NULL;
ALTER TABLE podium_orders ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE podium_orders ADD COLUMN IF NOT EXISTS budget NUMERIC(10,2);
ALTER TABLE podium_rounds ADD COLUMN IF NOT EXISTS budgets JSONB;
ALTER TABLE podium_rounds ADD COLUMN IF NOT EXISTS expected_count INTEGER;
