-- ═══════════════════════════════════════════════════════════════════════════
-- 081 — One run, one feed card: drop the Strava twin of a Garmin activity
--
-- DATA REPAIR, NOT SCHEMA. **RUN 080 FIRST** — see the warning below.
--
-- Ofer's athlete row holds 131 Garmin activities and 122 Strava ones, and 116 of
-- the Strava ones are the SAME RUN as a Garmin one: imported once by the Garmin
-- sync and once by the Strava import. Each has its own feed_items row, so his
-- feed shows 253 cards for 137 runs — every twinned run appears twice. He is the
-- only member affected; nobody else has both sources on one row.
--
-- WHICH COPY SURVIVES: the Garmin one. Measured across the 116 pairs, on
-- production 2026-09-04:
--
--   lap_count        on 76 Garmin copies, on NO Strava copy
--   perceived feel   only on the Garmin copy in 103 pairs, never only on Strava
--   calories         on all 116 Garmin copies, on NO Strava copy
--   avg cadence      on all 116 Garmin copies, on NO Strava copy
--   vo2max           on 71 Garmin copies, on NO Strava copy
--   route geometry   on 114 Garmin copies, on NO Strava copy (see below)
--   heart rate       on both, in all 116
--
-- The Garmin copy is richer on every axis. The lap count is what per-segment
-- planned-vs-actual grading keys off, and perceived feel is something Ofer typed
-- in himself — deleting the Garmin copy would throw both away. (The `laps` JSONB
-- array itself is NULL on 115 of the 116 survivors: Garmin's per-lap detail is
-- fetched on demand rather than stored, so only the count lives in the row.)
--
-- THEY WILL NOT COME BACK. src/lib/activity-dedup.ts already refuses to import a
-- run the other source has: same start within 15 minutes, distance within 10%.
-- All 116 pairs have IDENTICAL start times — 0 seconds apart, every one — and
-- distances within 0.01%, so the guard catches all 116 with room to spare. These
-- rows predate it: they were all created between 2026-08-21 and 2026-08-25, 102
-- of them on 08-24 alone, in one backfill burst. This is a one-time cleanup.
--
-- ABOUT THE MAP: a first pass at this file assumed 16 of the runs had their map
-- only on the Strava copy, and backfilled the geometry before deleting. That was
-- wrong, and worth writing down because the flag that says so is unreliable:
-- those 16 Strava rows have has_polyline = true and gps_points = NULL. The flag
-- is set from the presence of Strava's summary_polyline at sync time, but the
-- polyline is only decoded into gps_points by the separate enrich pass, which has
-- never run for them. Table-wide, has_polyline disagrees with the geometry on 985
-- of 2518 rows in both directions. Nothing is lost here: NO Strava twin carries
-- any route the Garmin copy lacks. (What actually draws the map is route_preview,
-- which a trigger keeps in step with gps_points; has_polyline is read only by
-- `hasRoute` in lib/feed/project.ts, which no component consumes.)
--
-- So the only columns this file can genuinely rescue are start_lat/start_lng, on
-- 16 pairs. The COALESCE list is wider than that on purpose — if the Strava
-- enrich backfill runs before this file does, the geometry becomes rescuable and
-- the same statement picks it up.
--
-- ONE LIKE AND ONE COMMENT have to be carried across by hand. feed_items rows
-- reference the activity ON DELETE CASCADE, so deleting the Strava row silently
-- takes its feed card, and with it the like and the Hebrew comment ('תותח') that
-- sit on the 2026-08-20 Morning Run's Strava card. Its Garmin twin's card has
-- neither. Step 1 moves them before anything is deleted.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ ORDER MATTERS: RUN 080 BEFORE THIS FILE.                                │
-- │ 080 merges the duplicate athlete rows, and it recognises the duplicate's │
-- │ activities as already-present by matching them against these very Strava │
-- │ rows. Delete them first and 080 would MOVE the duplicate's 108 copies    │
-- │ onto the real row instead of deleting them — re-creating the twins this  │
-- │ file exists to remove.                                                  │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- Idempotent: after a successful run no twin pairs remain, so it does nothing.
-- Scoped to one athlete on purpose. If another member ever ends up with both
-- sources on one row, widen `athlete_ids` deliberately rather than by accident.
--
-- Expected result: 253 activities → 137 (131 Garmin + 6 un-twinned Strava), and
-- the same 116 fewer cards in the feed.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- DRY RUN. Changes nothing. Expect 116 twins, 1 like and 1 comment to move,
-- 16 start-coordinate backfills, 0 maps rescued.
-- ───────────────────────────────────────────────────────────────────────────
WITH twins AS (
  SELECT s.id AS strava_id, g.id AS garmin_id, s.start_time,
         (g.start_lat IS NULL AND s.start_lat IS NOT NULL) AS start_coords_from_strava,
         (g.gps_points IS NULL AND s.gps_points IS NOT NULL) AS map_from_strava,
         (g.lap_count IS NOT NULL)                          AS survivor_has_laps,
         (g.perceived_feel IS NOT NULL)                      AS survivor_has_feel
    FROM athlete_activities s
    JOIN athlete_activities g
      ON g.athlete_id = s.athlete_id
     AND g.source = 'garmin'
     AND g.id <> s.id
     AND abs(extract(epoch FROM (g.start_time - s.start_time))) <= 300
   WHERE s.athlete_id = '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81'
     AND s.source = 'strava'
)
SELECT count(*)                                             AS strava_twins_to_delete,
       count(DISTINCT garmin_id)                            AS distinct_survivors, -- must equal the above
       count(*) FILTER (WHERE start_coords_from_strava)      AS start_coords_to_backfill,
       count(*) FILTER (WHERE map_from_strava)               AS maps_to_rescue,
       count(*) FILTER (WHERE survivor_has_laps)             AS survivors_with_laps,
       count(*) FILTER (WHERE survivor_has_feel)             AS survivors_with_feel,
       (SELECT count(*) FROM feed_likes l
          JOIN feed_items fi ON fi.id = l.feed_item_id
         WHERE fi.activity_id IN (SELECT strava_id FROM twins))    AS likes_to_move,
       (SELECT count(*) FROM feed_comments c
          JOIN feed_items fi ON fi.id = c.feed_item_id
         WHERE fi.activity_id IN (SELECT strava_id FROM twins))    AS comments_to_move
  FROM twins;

-- ───────────────────────────────────────────────────────────────────────────
-- THE REPAIR.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  athlete_ids CONSTANT uuid[] := ARRAY['4e7d7c0f-3a13-4c86-a5f8-b103f1506f81']::uuid[];
  n_pairs   int;
  n_survivors int;
  n_likes   int;
  n_comments int;
  n_enriched int;
  n_gone    int;
BEGIN
  -- One pairing, used by every step below: for each Strava row, the Garmin row of
  -- the same run. Nobody starts two recorded runs five minutes apart, so the
  -- window is safe; DISTINCT ON keeps the closest Garmin row if two ever tie.
  CREATE TEMP TABLE twin_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (s.id) s.id AS strava_id, g.id AS garmin_id
    FROM athlete_activities s
    JOIN athlete_activities g
      ON g.athlete_id = s.athlete_id
     AND g.source = 'garmin'
     AND g.id <> s.id
     AND abs(extract(epoch FROM (g.start_time - s.start_time))) <= 300
   WHERE s.athlete_id = ANY (athlete_ids)
     AND s.source = 'strava'
   ORDER BY s.id, abs(extract(epoch FROM (g.start_time - s.start_time)));

  SELECT count(*), count(DISTINCT garmin_id) INTO n_pairs, n_survivors FROM twin_pairs;
  IF n_pairs = 0 THEN
    RAISE NOTICE '081: no twinned activities left — already done.';
    RETURN;
  END IF;
  -- Two Strava rows pointing at one Garmin row would make step 3 pick a source
  -- row arbitrarily. Measured 116/116 distinct; if that ever stops holding, stop.
  IF n_survivors <> n_pairs THEN
    RAISE EXCEPTION '081: % twins map onto only % survivors — the 5-minute window is matching too loosely. Nothing changed.',
      n_pairs, n_survivors;
  END IF;

  -- The two cards for each run, resolved once.
  CREATE TEMP TABLE twin_cards ON COMMIT DROP AS
  SELECT p.strava_id, p.garmin_id, fs.id AS strava_card, fg.id AS garmin_card
    FROM twin_pairs p
    JOIN feed_items fs ON fs.activity_id = p.strava_id
    JOIN feed_items fg ON fg.activity_id = p.garmin_id;

  -- 1. Move the engagement off the card that is about to disappear. Deleting the
  --    activity cascades to its feed_items row and from there to its likes and
  --    comments, so this has to happen first or real member content is lost.

  --    feed_likes is UNIQUE(feed_item_id, athlete_id): drop any like that would
  --    collide with one the survivor's card already has, then move the rest.
  DELETE FROM feed_likes l
   USING twin_cards t
   WHERE l.feed_item_id = t.strava_card
     AND EXISTS (SELECT 1 FROM feed_likes k
                  WHERE k.feed_item_id = t.garmin_card AND k.athlete_id = l.athlete_id);

  UPDATE feed_likes l SET feed_item_id = t.garmin_card
    FROM twin_cards t WHERE l.feed_item_id = t.strava_card;
  GET DIAGNOSTICS n_likes = ROW_COUNT;

  UPDATE feed_comments c SET feed_item_id = t.garmin_card
    FROM twin_cards t WHERE c.feed_item_id = t.strava_card;
  GET DIAGNOSTICS n_comments = ROW_COUNT;

  -- 2. Repair the counters. like_count/comment_count are maintained by triggers
  --    on INSERT and DELETE of the rows above — NOT on an UPDATE of feed_item_id
  --    — so moving a like leaves the survivor's card still showing zero. Recount
  --    from the rows themselves, which is also self-healing if it ever drifts.
  --    comment_count tracks live comments only, hence the deleted_at filter.
  UPDATE feed_items fi SET
      like_count    = (SELECT count(*) FROM feed_likes    l WHERE l.feed_item_id = fi.id),
      comment_count = (SELECT count(*) FROM feed_comments c WHERE c.feed_item_id = fi.id
                                                              AND c.deleted_at IS NULL)
    WHERE fi.id IN (SELECT garmin_card FROM twin_cards);

  -- 3. Union the two activity rows into the survivor. COALESCE only, so nothing
  --    the Garmin row already knows is overwritten by the Strava copy.
  --
  --    has_polyline is deliberately NOT copied: it is false on the survivor and
  --    true on Strava twins that hold no geometry at all, so copying it would
  --    make the flag lie harder. It is set from the geometry the survivor ends up
  --    with, which is what lib/garmin/activity-detail.ts derives it from.
  --
  --    route_preview is listed for the case where gps_points does not move; when
  --    gps_points DOES move, the BEFORE UPDATE OF gps_points trigger
  --    (sync_route_preview, migration 047) recomputes route_preview and wins.
  UPDATE athlete_activities g SET
      gps_points      = COALESCE(g.gps_points,      s.gps_points),
      route_preview   = COALESCE(g.route_preview,   s.route_preview),
      start_lat       = COALESCE(g.start_lat,       s.start_lat),
      start_lng       = COALESCE(g.start_lng,       s.start_lng),
      end_lat         = COALESCE(g.end_lat,         s.end_lat),
      end_lng         = COALESCE(g.end_lng,         s.end_lng),
      location_name   = COALESCE(g.location_name,   s.location_name),
      elevation_gain  = COALESCE(g.elevation_gain,  s.elevation_gain),
      calories        = COALESCE(g.calories,        s.calories),
      avg_cadence     = COALESCE(g.avg_cadence,     s.avg_cadence),
      max_hr          = COALESCE(g.max_hr,          s.max_hr),
      average_hr      = COALESCE(g.average_hr,      s.average_hr),
      moving_duration = COALESCE(g.moving_duration, s.moving_duration),
      vo2max          = COALESCE(g.vo2max,          s.vo2max),
      shoe_id         = COALESCE(g.shoe_id,         s.shoe_id),
      has_polyline    = CASE
                          WHEN COALESCE(g.gps_points, s.gps_points) IS NULL THEN false
                          WHEN jsonb_typeof(COALESCE(g.gps_points, s.gps_points)) <> 'array' THEN false
                          ELSE jsonb_array_length(COALESCE(g.gps_points, s.gps_points)) > 1
                        END
      --
      -- strava_activity_id is deliberately NOT carried over, even though it would
      -- make the Strava sync skip the run via `existingByStrava`. Two reasons:
      -- hasCrossSourceDuplicate already stops the re-import (see the header), and
      -- setting it would make the survivor look like a Strava row to that same
      -- lookup — whose needsEnrich is `laps IS NULL`, true on 115 of the 116
      -- survivors. The next sync would then run enrichStravaActivity against the
      -- Garmin row and write Strava's geometry over it.
    FROM twin_pairs p
    JOIN athlete_activities s ON s.id = p.strava_id
   WHERE g.id = p.garmin_id;
  GET DIAGNOSTICS n_enriched = ROW_COUNT;

  -- 4. And the twin goes, taking its duplicate feed card with it.
  DELETE FROM athlete_activities
   WHERE id IN (SELECT strava_id FROM twin_pairs);
  GET DIAGNOSTICS n_gone = ROW_COUNT;

  RAISE NOTICE '081: % twin(s) deleted with their duplicate feed cards; % survivor(s) enriched; % like(s) and % comment(s) moved to the surviving card.',
    n_gone, n_enriched, n_likes, n_comments;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect 137 activities (131 garmin + 6 strava), 137 live feed cards,
-- and no remaining twins.
-- ───────────────────────────────────────────────────────────────────────────
SELECT a.source,
       count(*)                                                       AS activities,
       count(fi.id) FILTER (WHERE fi.deleted_at IS NULL)              AS live_feed_cards,
       sum(fi.like_count)                                             AS likes,
       sum(fi.comment_count)                                          AS comments
  FROM athlete_activities a
  LEFT JOIN feed_items fi ON fi.activity_id = a.id
 WHERE a.athlete_id = '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81'
 GROUP BY ROLLUP (a.source)
 ORDER BY a.source NULLS LAST;
