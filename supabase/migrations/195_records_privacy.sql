-- 195 — שיאים tab privacy (design/records-prototype, 2026-11-21). Paste by hand.
--
-- leaderboard_opt_out: the runner sees every board; no board shows them (weekly,
--   champions, club records, record history). Routes treat a missing column as false.
-- squad_compare: opt-in to the anonymous squad median on "my progress". Self-only.
--
-- The tab itself is gated by feature_enablements (191), feature key 'records_tab' —
-- no schema needed for that.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS leaderboard_opt_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS squad_compare BOOLEAN NOT NULL DEFAULT false;
