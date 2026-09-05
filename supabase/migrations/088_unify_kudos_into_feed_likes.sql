-- ═══════════════════════════════════════════════════════════════════════════
-- 088 — One reaction table: fold activity_kudos into feed_likes
--
-- Two tables held the same gesture:
--
--   feed_likes(feed_item_id, athlete_id)    ❤️ on a feed card. Has the counter
--                                           trigger that keeps
--                                           feed_items.like_count honest.
--   activity_kudos(activity_id, athlete_id) 👍 on a push notification and in the
--                                           Notification Center. No counter, and
--                                           invisible to the feed.
--
-- So a run could show 0 likes on its card while carrying three kudos; giving
-- kudos from a notification left the card un-hearted; un-hearting the card left
-- the kudos standing. `feed_likes` wins — it is the one with the trigger and the
-- one the feed reads. The activity-keyed API still exists (the service worker's
-- 👍 only knows the activity id) and now resolves through feed_items.activity_id.
--
-- ⚠️ Run this BEFORE deploying the code that reads feed_likes for kudos, or the
-- reactions that already exist read as not-given for as long as the gap lasts.
-- Measured on prod at the time of writing: 2 kudos rows, both with a feed item,
-- neither already a like — so this moves 2 rows. It is written to be re-runnable
-- and to tell you what it did.
--
-- activity_kudos is deliberately NOT dropped here. It keeps the original rows as
-- a way back if something about this is wrong; the DROP is at the bottom,
-- commented out, to run once the unified path has been live for a while.
--
-- Apply manually in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  moved    int;
  orphans  int;
  already  int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'activity_kudos'
  ) THEN
    RAISE NOTICE '088: activity_kudos does not exist — nothing to migrate.';
    RETURN;
  END IF;

  -- Kudos on a run that has no feed item: the run predates the feed (migration
  -- 047 added the trigger that creates one per activity) or its item was
  -- deleted. There is nowhere to put these, so they stay in activity_kudos and
  -- get counted out loud rather than silently dropped.
  SELECT count(*) INTO orphans
    FROM activity_kudos k
   WHERE NOT EXISTS (
     SELECT 1 FROM feed_items f
      WHERE f.activity_id = k.activity_id AND f.type = 'activity' AND f.deleted_at IS NULL
   );

  -- Already both, e.g. someone who hearted the card and then tapped 👍 on the
  -- push. Reported so the "moved" number below isn't mistaken for a total.
  SELECT count(*) INTO already
    FROM activity_kudos k
    JOIN feed_items f
      ON f.activity_id = k.activity_id AND f.type = 'activity' AND f.deleted_at IS NULL
    JOIN feed_likes l
      ON l.feed_item_id = f.id AND l.athlete_id = k.athlete_id;

  -- The move itself. created_at is carried over so the "who reacted" row stays in
  -- the order it actually happened in, and ON CONFLICT makes a re-run a no-op.
  -- The INSERT fires trg_feed_like_count, so like_count follows along; the
  -- reconciliation below is belt-and-braces for anything that predates it.
  WITH mapped AS (
    SELECT DISTINCT ON (f.id, k.athlete_id)
           f.id AS feed_item_id, k.athlete_id, k.created_at
      FROM activity_kudos k
      JOIN feed_items f
        ON f.activity_id = k.activity_id AND f.type = 'activity' AND f.deleted_at IS NULL
     ORDER BY f.id, k.athlete_id, k.created_at
  ), inserted AS (
    INSERT INTO feed_likes (feed_item_id, athlete_id, created_at)
    SELECT feed_item_id, athlete_id, created_at FROM mapped
    ON CONFLICT (feed_item_id, athlete_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO moved FROM inserted;

  RAISE NOTICE '088: moved % kudos into feed_likes (% were already a like, % have no feed item and stay put).',
    moved, already, orphans;
END $$;

-- Recompute like_count from the rows themselves, for every item that has any.
-- The trigger keeps this right going forward; this is the one-time repair for
-- anything that drifted while two tables were counting separately.
UPDATE feed_items f
   SET like_count = c.n
  FROM (SELECT feed_item_id, count(*) AS n FROM feed_likes GROUP BY feed_item_id) c
 WHERE c.feed_item_id = f.id
   AND f.like_count <> c.n;

-- And zero the ones whose likes are all gone (the UPDATE above can't see them).
UPDATE feed_items f
   SET like_count = 0
 WHERE f.like_count <> 0
   AND NOT EXISTS (SELECT 1 FROM feed_likes l WHERE l.feed_item_id = f.id);

COMMENT ON TABLE activity_kudos IS
  'SUPERSEDED by feed_likes (migration 088). No code reads or writes this table; '
  'it is kept only as a copy of the pre-unification rows. Safe to drop.';

-- Once the unified path has been live and boring for a while:
-- DROP TABLE IF EXISTS activity_kudos;
