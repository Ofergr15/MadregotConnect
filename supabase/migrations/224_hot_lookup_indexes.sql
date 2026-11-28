-- 224_hot_lookup_indexes.sql — PROPOSED by docs/migrations-audit.md (finding C). NOT applied.
-- Paste by hand; CONCURRENTLY so it never locks writes. Run each statement on its own
-- (CREATE INDEX CONCURRENTLY cannot run inside a transaction block). Idempotent.

-- weekly_plans is read by (athlete_id, week_start_date) ~68 times in src
-- (.eq('week_start_date') next to .eq('athlete_id')). Only (athlete_id) and
-- (coach_id, week_start_date) exist today.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_weekly_plans_athlete_week
  ON public.weekly_plans (athlete_id, week_start_date);

-- workout_deliveries: per-athlete per-day lookups (~29 call sites filter workout_date)
-- with only (athlete_id) and (plan_id) indexed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workout_deliveries_athlete_date
  ON public.workout_deliveries (athlete_id, workout_date);

-- The bulk email send's suppression read (b25, migration 222 — only if 222 is applied):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS email_events_recipient_type_idx
--     ON public.email_events (type, recipient) WHERE type IN ('complained', 'bounced');
