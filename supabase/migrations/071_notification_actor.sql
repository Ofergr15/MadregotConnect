-- Extends scheduled_notifications to also represent persisted social-activity
-- events (like/comment/badge/kudos/follow/coach reply), not just admin
-- broadcasts — so the in-app Notification Center becomes a real history of
-- everything that ever notified you, the way Instagram/Strava's notification
-- centers work, instead of only ever showing coach-composed campaigns.
-- Null actor = system/broadcast (existing rows, unaffected); set actor = a
-- specific person did this to you, so the UI can show their avatar.
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS actor_athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_actor ON scheduled_notifications(actor_athlete_id);
