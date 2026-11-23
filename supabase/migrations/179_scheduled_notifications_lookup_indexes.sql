-- 179: indexes for the two hottest scheduled_notifications lookups.
--
-- Measured on production 2026-11-19 (pg_stat_statements / pg_stat_user_tables):
-- the table had 211,818 sequential scans reading 5.1 billion rows. The top query
-- (75k calls) is the cron idempotency ledger: WHERE kind = $1 AND url = $2
-- (cron/tick, cron/workout-watch, post-workout, feedback-notify, feed/notify),
-- and no index covers it, so every check reads all ~61k rows. The second
-- (2.9k calls, 46 ms avg) filters on audience_type + audience_id.
--
-- Additive only. CONCURRENTLY keeps writes flowing while it builds; run each
-- statement on its own in the SQL editor (not inside a transaction).
create index concurrently if not exists idx_scheduled_notifications_kind_url
  on public.scheduled_notifications (kind, url);
create index concurrently if not exists idx_scheduled_notifications_audience
  on public.scheduled_notifications (audience_type, audience_id);
