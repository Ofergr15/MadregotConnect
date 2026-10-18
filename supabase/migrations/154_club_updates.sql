-- "עדכונים מהמועדון" (mockup ~/.cache/madregot/club-updates/full-mockup.html): short live
-- updates from the staff, one stream, shown in the feed as one card while it is fresh.
--
-- club_updates: one row per update. body carries @[Name](id) mention tokens like a feed
-- post. breaking = orange in the stream and a push to the club. notify_at is when the
-- push may go (a few seconds after publishing, so "ביטול" can still stop it); notified_at
-- is the send's idempotency claim, set with `WHERE notified_at IS NULL`. deleted_at is a
-- soft delete, so "שחזור" right after a delete brings it back.
--
-- club_update_topics: a race day or any other subject the updates are grouped under
-- (phase 2 — the table is here so that needs no second paste). topic_id null = general.
--
-- club_update_reactions: one emoji per (update, athlete, emoji).
--
-- No foreign key to athletes on purpose (schemaEmbedAmbiguity.test.ts).
-- The on/off switch and who may write live in app_settings ('club_updates'), not here.
--
-- OPTIONAL until pasted: without it the stream reads as empty and the admin screen says
-- the tables are missing.

CREATE TABLE IF NOT EXISTS club_update_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  event_id UUID,
  pinned_text TEXT,
  opens_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_athlete_id UUID NOT NULL,
  topic_id UUID REFERENCES club_update_topics(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1200),
  image_url TEXT,
  breaking BOOLEAN NOT NULL DEFAULT false,
  pinned BOOLEAN NOT NULL DEFAULT false,
  notify_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_updates_recent ON club_updates (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS club_update_reactions (
  update_id UUID NOT NULL REFERENCES club_updates(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (update_id, athlete_id, emoji)
);

ALTER TABLE club_update_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_update_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE club_update_topics FROM anon, authenticated;
REVOKE ALL ON TABLE club_updates FROM anon, authenticated;
REVOKE ALL ON TABLE club_update_reactions FROM anon, authenticated;
GRANT ALL ON TABLE club_update_topics TO service_role;
GRANT ALL ON TABLE club_updates TO service_role;
GRANT ALL ON TABLE club_update_reactions TO service_role;
NOTIFY pgrst, 'reload schema';
