-- 106_athlete_favorites.sql
--
-- A member's own shortlist of teammates, and the feed filter built on it.
--
-- Reported as ff8d932e: "add to favorites for specific athletes, and then a
-- Favorites view". Sent from /feed, which is what the view is for — the club
-- feed is one undifferentiated stack, and "what did the three people I actually
-- train with do this morning" is a question no chip on that screen could answer.
--
-- ── WHY THIS IS NOT athlete_follows (migration 060) ─────────────────────────
-- The obvious move is to reuse the existing follow graph: the table is there,
-- the button is on every teammate profile, and "following" reads like
-- "favourite". It does not work. In prod today athlete_follows holds 552 rows
-- for 24 athletes — 24 x 23, a COMPLETE mesh: everybody follows everybody. So
-- the column carries no signal at all, and a feed filtered by it is the club
-- feed with extra steps. Curating it would also mean UNfollowing twenty
-- teammates, which is a socially loud act in a small club and would quietly
-- change who gets "X started following you" pushes.
--
-- The two concepts are genuinely different and now stay that way: a follow is
-- part of the social graph and is visible to the other person, a favourite is a
-- private reading preference and is visible to nobody. Nothing here is ever
-- exposed on the favourited athlete's profile or in any count.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS athlete_favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- The owner of the list. Always the acting athlete from the verified session;
  -- the API never takes it from a request body.
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  favorite_athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A repeat "favourite" is a no-op rather than a second row, so a double tap
  -- on a slow connection cannot make one teammate appear twice in the list.
  UNIQUE (athlete_id, favorite_athlete_id),
  -- Your own runs are already the ones you can't miss.
  CHECK (athlete_id != favorite_athlete_id)
);

-- Every read is "the list belonging to one athlete" — the feed filter resolves
-- the whole list on each page request.
CREATE INDEX IF NOT EXISTS idx_athlete_favorites_owner
  ON athlete_favorites (athlete_id);

ALTER TABLE athlete_favorites ENABLE ROW LEVEL SECURITY;

-- Same posture as athlete_follows: the app reaches this table only through
-- service-role API routes that have already established who the caller is, so
-- there is no anon/authenticated policy to widen here.
DROP POLICY IF EXISTS "Service role manages athlete favorites" ON athlete_favorites;
CREATE POLICY "Service role manages athlete favorites"
  ON athlete_favorites FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
