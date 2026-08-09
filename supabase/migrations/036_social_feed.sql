-- Social feed (PRD §3 interactions + §10 community). See docs/feed-plan.md.
--
-- One polymorphic `feed_items` table backs both the Strava-style activity feed and
-- the Facebook-style free posts, so likes/comments are implemented ONCE against
-- feed_item_id and work for every current and future item type.
--
-- Run this in the Supabase SQL Editor.

-- ─── Route preview ───────────────────────────────────────────────────────────────
-- The feed list must never ship full polylines: a page of 20 runs at a few thousand
-- points each is multiple megabytes on a phone. `route_preview` is gps_points
-- downsampled to ~60 points — enough to draw a recognisable shape in a card. Full
-- resolution still comes from /api/garmin/activity-details when a card is expanded.

CREATE OR REPLACE FUNCTION downsample_route(pts JSONB, target INT DEFAULT 60)
RETURNS JSONB AS $$
DECLARE
  n INT;
  step INT;
BEGIN
  IF pts IS NULL OR jsonb_typeof(pts) <> 'array' THEN RETURN NULL; END IF;
  n := jsonb_array_length(pts);
  IF n = 0 THEN RETURN '[]'::jsonb; END IF;
  IF n <= target THEN RETURN pts; END IF;
  step := GREATEST(1, n / target);
  RETURN COALESCE(
    (SELECT jsonb_agg(pts -> i ORDER BY i)
       FROM generate_series(0, n - 1, step) AS i),
    '[]'::jsonb
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS route_preview JSONB;

-- Keep route_preview in step with gps_points automatically, so no sync path (Garmin,
-- Strava, or anything added later) has to remember to populate it.
CREATE OR REPLACE FUNCTION sync_route_preview() RETURNS TRIGGER AS $$
BEGIN
  -- Branch on TG_OP explicitly: OLD is unassigned in an INSERT trigger, so it must
  -- not be referenced there at all (PL/pgSQL does not reliably short-circuit an OR).
  IF TG_OP = 'INSERT' THEN
    NEW.route_preview := downsample_route(NEW.gps_points);
  ELSIF NEW.gps_points IS DISTINCT FROM OLD.gps_points THEN
    NEW.route_preview := downsample_route(NEW.gps_points);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_route_preview ON athlete_activities;
CREATE TRIGGER trg_route_preview
  BEFORE INSERT OR UPDATE OF gps_points ON athlete_activities
  FOR EACH ROW EXECUTE FUNCTION sync_route_preview();

UPDATE athlete_activities
   SET route_preview = downsample_route(gps_points)
 WHERE gps_points IS NOT NULL AND route_preview IS NULL;

-- ─── feed_items ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feed_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 'activity'    → a synced run (auto-created by the trigger below)
  -- 'post'        → free text + optional images, written by a member
  -- 'achievement' → badge award (§11, later)
  -- 'announcement'→ message from the staff (§3 "הודעות מהצוות", later)
  -- 'new_plan'    → a week's plan was published (§3 "אימונים חדשים", later)
  type TEXT NOT NULL CHECK (type IN ('activity', 'post', 'achievement', 'announcement', 'new_plan')),

  -- NULL for club/system items that no member authored (e.g. announcements).
  author_athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,

  -- Set only for type='activity'.
  activity_id UUID REFERENCES athlete_activities(id) ON DELETE CASCADE,

  body TEXT,                    -- post text / caption / announcement body
  media JSONB,                  -- [{ path, url, w, h }] for uploaded images
  payload JSONB,                -- type-specific extras (badge code, plan week, …)

  -- Sort key. For runs this is the run's start_time (NOT the sync time), so a run
  -- synced days late still lands in the right place chronologically.
  occurred_at TIMESTAMPTZ NOT NULL,

  -- Unused today: decision 1 made the feed club-wide. Present so narrowing
  -- visibility later is a WHERE clause rather than a migration.
  visibility TEXT NOT NULL DEFAULT 'club' CHECK (visibility IN ('club', 'group', 'private')),
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,

  -- Denormalised so rendering a page of items needs no per-item aggregates.
  -- Maintained by the triggers below; never write these from application code.
  like_count INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one feed item per activity — makes the auto-create trigger idempotent and
-- protects against a re-sync duplicating a run in the feed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_items_activity
  ON feed_items(activity_id) WHERE activity_id IS NOT NULL;

-- The feed's only hot query: live items, newest first (keyset paginated).
CREATE INDEX IF NOT EXISTS idx_feed_items_occurred
  ON feed_items(occurred_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_feed_items_author
  ON feed_items(author_athlete_id, occurred_at DESC) WHERE deleted_at IS NULL;

-- ─── feed_likes ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feed_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feed_item_id UUID NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One like per person per item; the API toggles by insert/delete against this.
  UNIQUE(feed_item_id, athlete_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_likes_athlete ON feed_likes(athlete_id);

-- ─── feed_comments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feed_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feed_item_id UUID NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  -- Soft delete: keeps thread continuity readable and leaves an audit trail for
  -- staff moderation.
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_comments_item
  ON feed_comments(feed_item_id, created_at) WHERE deleted_at IS NULL;

-- ─── Counter maintenance ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION feed_like_count_sync() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feed_items SET like_count = like_count + 1 WHERE id = NEW.feed_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feed_items SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.feed_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feed_like_count ON feed_likes;
CREATE TRIGGER trg_feed_like_count
  AFTER INSERT OR DELETE ON feed_likes
  FOR EACH ROW EXECUTE FUNCTION feed_like_count_sync();

-- comment_count tracks LIVE comments only, so it has to react to the soft-delete
-- UPDATE as well as INSERT/DELETE.
CREATE OR REPLACE FUNCTION feed_comment_count_sync() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      UPDATE feed_items SET comment_count = comment_count + 1 WHERE id = NEW.feed_item_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE feed_items SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.feed_item_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE feed_items SET comment_count = GREATEST(0, comment_count - 1) WHERE id = NEW.feed_item_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE feed_items SET comment_count = comment_count + 1 WHERE id = NEW.feed_item_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feed_comment_count ON feed_comments;
CREATE TRIGGER trg_feed_comment_count
  AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON feed_comments
  FOR EACH ROW EXECUTE FUNCTION feed_comment_count_sync();

-- ─── Runs become feed items automatically ────────────────────────────────────────
-- Done in the DB rather than in the sync route so EVERY import path (Garmin sync,
-- Strava sync, backfills, future integrations) produces feed items with no code
-- change and no chance of one path forgetting.

CREATE OR REPLACE FUNCTION feed_item_for_activity() RETURNS TRIGGER AS $$
DECLARE
  ath_group UUID;
BEGIN
  SELECT group_id INTO ath_group FROM athletes WHERE id = NEW.athlete_id;

  -- Bare DO NOTHING (no inference target): activity_id is always non-null here, so
  -- the partial unique index applies, and this stays correct if constraints change.
  INSERT INTO feed_items (type, author_athlete_id, activity_id, occurred_at, group_id)
  VALUES ('activity', NEW.athlete_id, NEW.id, NEW.start_time, ath_group)
  ON CONFLICT DO NOTHING;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feed_item_for_activity ON athlete_activities;
CREATE TRIGGER trg_feed_item_for_activity
  AFTER INSERT ON athlete_activities
  FOR EACH ROW EXECUTE FUNCTION feed_item_for_activity();

-- Backfill the existing history so the feed isn't empty on first open.
INSERT INTO feed_items (type, author_athlete_id, activity_id, occurred_at, group_id)
SELECT 'activity', aa.athlete_id, aa.id, aa.start_time, a.group_id
  FROM athlete_activities aa
  JOIN athletes a ON a.id = aa.athlete_id
 WHERE NOT EXISTS (SELECT 1 FROM feed_items fi WHERE fi.activity_id = aa.id);

-- ─── Storage for post images ─────────────────────────────────────────────────────
-- Public read, matching the existing `avatars` bucket. Writes go only through
-- /api/feed/media, which runs with the service role after verifying the caller's JWT.

INSERT INTO storage.buckets (id, name, public)
VALUES ('feed-media', 'feed-media', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access for feed media') THEN
    CREATE POLICY "Public read access for feed media"
      ON storage.objects FOR SELECT USING (bucket_id = 'feed-media');
  END IF;
END $$;

-- Service-role requests bypass RLS; these policies would grant public writes.
DROP POLICY IF EXISTS "Service role upload for feed media" ON storage.objects;
DROP POLICY IF EXISTS "Service role delete for feed media" ON storage.objects;

-- ─── RLS ─────────────────────────────────────────────────────────────────────────
-- All feed access goes through API routes using the service role (which bypasses
-- RLS), exactly like every other table in this app. RLS is enabled with no policies
-- so that the anon/public key cannot read or write these tables directly.

ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments ENABLE ROW LEVEL SECURITY;

-- ─── Nav ─────────────────────────────────────────────────────────────────────────
-- The nav renders a tab only when an enabled role_tab_permissions row exists.

INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'feed', true),
  ('coach', 'feed', true),
  ('academy_coach', 'feed', true),
  ('runner', 'feed', true),
  ('core_runner', 'feed', true),
  ('viewer', 'feed', false)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'feed', true),
  ('coach', 'feed', true),
  ('academy_coach', 'feed', true),
  ('runner', 'feed', true),
  ('core_runner', 'feed', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;
