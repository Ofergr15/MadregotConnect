-- First time the app actually OPENED for this member.
--
-- `last_seen_at` (010) is stamped on every visit, so it can answer "are they
-- around" and nothing else. The 15-minute setup snapshot needs the other end of
-- the same story — "they got in a quarter of an hour ago, did they finish?" —
-- and there was no column that could tell us that.
--
-- Why not auth.users.created_at: an auth account is minted the moment a Strava
-- callback lands, which is BEFORE the app has opened at all. That is exactly the
-- iOS in-app-browser case (migration 082): login succeeds inside another app's
-- browser sheet, the app itself never opens, and a "15 minutes after login"
-- reminder built on that timestamp would fire into the void and then never fire
-- again for the one person who needed it. This column is stamped by
-- /api/auth/me, so it means the app ran.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;

-- Backdate everybody who is already in. Without this, 23 existing members would
-- have a NULL that /api/auth/me fills with NOW() on their next visit, and each
-- of them would look like a brand-new arrival 15 minutes later.
UPDATE athletes
   SET first_seen_at = COALESCE(last_seen_at, created_at)
 WHERE first_seen_at IS NULL;

COMMENT ON COLUMN athletes.first_seen_at IS
  'First /api/auth/me call — when the app first opened for them. Drives the 15-minute setup snapshot.';
