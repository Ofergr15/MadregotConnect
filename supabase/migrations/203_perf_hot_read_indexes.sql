-- 203: indexes for the hot per-member reads (perf S6, review-2026-11-20 track-a-perf-server-wins.md).
--
-- WRITE-ONLY in this PR: nothing here has been run on production. Before pasting, check each with
-- EXPLAIN ANALYZE on the query named beside it; drop any the planner doesn't pick.
--
-- Additive only. CONCURRENTLY keeps writes flowing while it builds; run each statement ON ITS OWN in
-- the SQL editor (not inside a transaction). Safe to re-run (IF NOT EXISTS).

-- Every self-scoped activity list, week window, profile and volume history:
--   athlete_activities WHERE athlete_id = $1 ORDER BY start_time DESC
-- (today there are two single-column indexes, athlete_id and start_time, and the planner can use only one).
create index concurrently if not exists idx_athlete_activities_athlete_start
  on public.athlete_activities (athlete_id, start_time desc);

-- /api/notifications/inbox (every bell): status = 'sent' ORDER BY last_sent_at DESC LIMIT 150.
-- idx_scheduled_notifications_due is (status, next_run_at) and can't serve the order.
create index concurrently if not exists idx_scheduled_notifications_sent_recent
  on public.scheduled_notifications (last_sent_at desc)
  where status = 'sent';

-- The per-run feedback lookup (post-workout prompt answered?): athlete_id + garmin_activity_id.
create index concurrently if not exists idx_workout_feedback_athlete_activity
  on public.workout_feedback (athlete_id, garmin_activity_id);
