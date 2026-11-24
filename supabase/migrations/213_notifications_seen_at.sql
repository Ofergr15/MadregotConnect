-- 213: "read" for notifications gets its own timestamp (PWA F1, 2026-11-24).
--
-- Until now unread = everything sent after athletes.last_seen_at, and GET /api/auth/me stamps
-- last_seen_at on EVERY page load. So opening any screen silently marked every notification
-- read: the bell said 2, the inbox (fetched a moment later) showed nothing new. last_seen_at
-- stays what the admin screens use it for — "last active" — and notifications_seen_at moves
-- only when the member has actually looked at the inbox (POST /api/notifications/seen).
--
-- Paste into the Supabase SQL editor. Safe to re-run. Until it is applied the code falls back
-- to last_seen_at (the old behaviour), so nothing breaks before the paste.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS notifications_seen_at TIMESTAMPTZ;

-- Start everyone where they are today, so the first deploy doesn't light up months of history.
UPDATE athletes SET notifications_seen_at = last_seen_at
 WHERE notifications_seen_at IS NULL AND last_seen_at IS NOT NULL;
