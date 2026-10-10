DO $$
DECLARE n_pairs int; n_survivors int; n_likes int; n_comments int; n_gone int;
BEGIN
  CREATE TEMP TABLE twin_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (s.id) s.id AS strava_id, g.id AS garmin_id
    FROM athlete_activities s
    JOIN athlete_activities g
      ON g.athlete_id = s.athlete_id AND g.source = 'garmin' AND s.source = 'strava'
     AND abs(extract(epoch FROM (g.start_time - s.start_time))) <= 120
     AND g.duration > 0 AND s.duration > 0
     AND (least(extract(epoch FROM g.start_time) + g.duration, extract(epoch FROM s.start_time) + s.duration)
          - greatest(extract(epoch FROM g.start_time), extract(epoch FROM s.start_time))) / greatest(g.duration, s.duration) >= 0.85
   ORDER BY s.id, abs(extract(epoch FROM (g.start_time - s.start_time)));
  SELECT count(*), count(DISTINCT garmin_id) INTO n_pairs, n_survivors FROM twin_pairs;
  IF n_pairs = 0 THEN RAISE NOTICE '141: nothing to merge'; RETURN; END IF;
  IF n_survivors <> n_pairs THEN RAISE EXCEPTION '141: % twins onto % survivors, nothing changed', n_pairs, n_survivors; END IF;
  CREATE TEMP TABLE twin_cards ON COMMIT DROP AS
  SELECT p.strava_id, p.garmin_id, fs.id AS strava_card, fg.id AS garmin_card
    FROM twin_pairs p JOIN feed_items fs ON fs.activity_id = p.strava_id JOIN feed_items fg ON fg.activity_id = p.garmin_id;
  DELETE FROM feed_likes l USING twin_cards t
   WHERE l.feed_item_id = t.strava_card
     AND EXISTS (SELECT 1 FROM feed_likes k WHERE k.feed_item_id = t.garmin_card AND k.athlete_id = l.athlete_id);
  UPDATE feed_likes l SET feed_item_id = t.garmin_card FROM twin_cards t WHERE l.feed_item_id = t.strava_card;
  GET DIAGNOSTICS n_likes = ROW_COUNT;
  UPDATE feed_comments c SET feed_item_id = t.garmin_card FROM twin_cards t WHERE c.feed_item_id = t.strava_card;
  GET DIAGNOSTICS n_comments = ROW_COUNT;
  UPDATE feed_items fi SET
      like_count = (SELECT count(*) FROM feed_likes l WHERE l.feed_item_id = fi.id),
      comment_count = (SELECT count(*) FROM feed_comments c WHERE c.feed_item_id = fi.id AND c.deleted_at IS NULL)
   WHERE fi.id IN (SELECT garmin_card FROM twin_cards);
  UPDATE athlete_activities g SET
      gps_points = COALESCE(g.gps_points, s.gps_points),
      route_preview = COALESCE(g.route_preview, s.route_preview),
      start_lat = COALESCE(g.start_lat, s.start_lat), start_lng = COALESCE(g.start_lng, s.start_lng),
      end_lat = COALESCE(g.end_lat, s.end_lat), end_lng = COALESCE(g.end_lng, s.end_lng),
      location_name = COALESCE(g.location_name, s.location_name),
      elevation_gain = COALESCE(g.elevation_gain, s.elevation_gain),
      calories = COALESCE(g.calories, s.calories),
      avg_cadence = COALESCE(g.avg_cadence, s.avg_cadence),
      max_hr = COALESCE(g.max_hr, s.max_hr), average_hr = COALESCE(g.average_hr, s.average_hr),
      moving_duration = COALESCE(g.moving_duration, s.moving_duration),
      laps = COALESCE(g.laps, s.laps),
      perceived_rpe = COALESCE(g.perceived_rpe, s.perceived_rpe), perceived_feel = COALESCE(g.perceived_feel, s.perceived_feel),
      shoe_id = COALESCE(g.shoe_id, s.shoe_id),
      has_polyline = CASE WHEN COALESCE(g.gps_points, s.gps_points) IS NULL THEN false
                          WHEN jsonb_typeof(COALESCE(g.gps_points, s.gps_points)) <> 'array' THEN false
                          ELSE jsonb_array_length(COALESCE(g.gps_points, s.gps_points)) > 1 END
    FROM twin_pairs p JOIN athlete_activities s ON s.id = p.strava_id
   WHERE g.id = p.garmin_id;
  DELETE FROM athlete_activities WHERE id IN (SELECT strava_id FROM twin_pairs);
  GET DIAGNOSTICS n_gone = ROW_COUNT;
  RAISE NOTICE '141: % strava twin(s) merged into Garmin; % like(s), % comment(s) moved', n_gone, n_likes, n_comments;
END $$;
