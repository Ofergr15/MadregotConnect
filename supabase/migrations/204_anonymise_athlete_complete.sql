-- 204 — anonymise_athlete, complete (App Store guideline 5.1.1(v), account deletion).
-- Paste by hand in the Supabase SQL editor, AFTER 193 (it needs
-- account_deletion_requests). Idempotent: CREATE OR REPLACE of 193's function with the
-- same signature, so pasting 193 again later would silently downgrade it — paste 204 last.
--
-- What the app promises (native DeleteRequestState): within 7 days, remove name, photo
-- and personal details; GPS maps of runs; the Garmin/Strava connection; messages written
-- in chats; push devices. What stays: numeric club totals (distance, duration, pace, HR on
-- athlete_activities) under an anonymous name.
--
-- 193's version missed: activity_streams (the full 1 Hz GPS + HR trace), athlete_devices
-- / device_tokens (native push + watch), strava_athlete_id, chat and comment bodies, post
-- text, face-recognition data, and every optional profile column added since. This one
-- covers all of those. It does NOT reach outside Postgres: the avatar / feed-media /
-- face-crops storage objects, the Stream run-chat messages and the auth.users login are
-- removed by POST /api/admin/account-deletion (admin only), which calls this function.
--
-- Every optional table/column is touched only if it exists (migrations land out of order).

CREATE OR REPLACE FUNCTION anonymise_athlete(target uuid, admin_id uuid DEFAULT NULL) RETURNS void AS $$
DECLARE
  col text;
  has_col boolean;
BEGIN
  -- 1. Identity and personal details on the athlete row ─────────────────────────
  UPDATE athletes SET name = 'חבר/ה לשעבר', avatar_url = NULL WHERE id = target;
  UPDATE athletes SET email = 'deleted+' || target::text || '@invalid' WHERE id = target;

  FOREACH col IN ARRAY ARRAY[
    'phone','birth_date','gender','height_cm','weight_kg','max_hr_bpm',
    'shirt_size','pants_size','shoe_size','socks_size','tights_size',
    'garmin_auth','strava_auth','strava_athlete_id','active_shoe_id',
    'notification_prefs','story_prefs','setup_progress','pending_group_id','pending_group_from'
  ] LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'athletes' AND column_name = col
                      AND is_nullable = 'YES') INTO has_col;
    IF has_col THEN
      EXECUTE format('UPDATE athletes SET %I = NULL WHERE id = $1', col) USING target;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY['discoverable','has_garmin','has_strava','strava_enabled','hr_trace_public'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'athletes' AND column_name = col) THEN
      EXECUTE format('UPDATE athletes SET %I = false WHERE id = $1', col) USING target;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'athletes' AND column_name = 'leaderboard_opt_out') THEN
    UPDATE athletes SET leaderboard_opt_out = true WHERE id = target;
  END IF;

  -- 2. Where they ran: route geometry and the full sample trace ───────────────────
  -- gps_points NULL means "not fetched yet" (018) and invites a re-fetch; an empty
  -- array means "fetched, nothing there". Laps go too: Garmin's carry each lap's
  -- start coordinates. The per-run totals and per-km `splits` stay.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'athlete_activities' AND column_name = 'gps_points') THEN
    UPDATE athlete_activities SET gps_points = '[]'::jsonb WHERE athlete_id = target;
  END IF;
  FOREACH col IN ARRAY ARRAY['laps','route_preview','route_preview_hd','polyline','summary_polyline','start_latlng','end_latlng'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'athlete_activities' AND column_name = col) THEN
      EXECUTE format('UPDATE athlete_activities SET %I = NULL WHERE athlete_id = $1', col) USING target;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'athlete_activities' AND column_name = 'has_polyline') THEN
    UPDATE athlete_activities SET has_polyline = false WHERE athlete_id = target;
  END IF;
  IF to_regclass('public.activity_streams') IS NOT NULL THEN
    DELETE FROM activity_streams WHERE activity_id IN (SELECT id FROM athlete_activities WHERE athlete_id = target);
  END IF;

  -- 3. What they wrote: posts, comments, chat-style threads ──────────────────────
  UPDATE feed_items SET deleted_at = COALESCE(deleted_at, now()), body = NULL WHERE author_athlete_id = target;
  IF to_regclass('public.feed_comments') IS NOT NULL THEN
    UPDATE feed_comments SET body = '', deleted_at = COALESCE(deleted_at, now()) WHERE athlete_id = target;
  END IF;
  IF to_regclass('public.run_meetup_messages') IS NOT NULL THEN
    UPDATE run_meetup_messages SET body = '' WHERE athlete_id = target;
  END IF;
  IF to_regclass('public.workout_feedback_messages') IS NOT NULL THEN
    UPDATE workout_feedback_messages SET body = '' WHERE sender_athlete_id = target;
  END IF;
  IF to_regclass('public.pain_report_messages') IS NOT NULL THEN
    UPDATE pain_report_messages SET body = '' WHERE sender_id = target::text AND NOT from_staff;
  END IF;

  -- 4. Face recognition: their reference faces go, detections lose the name ───────
  IF to_regclass('public.athlete_faces') IS NOT NULL THEN
    DELETE FROM athlete_faces WHERE athlete_id = target;
  END IF;
  IF to_regclass('public.detected_faces') IS NOT NULL THEN
    UPDATE detected_faces SET athlete_id = NULL WHERE athlete_id = target;
  END IF;

  -- 5. Devices: web push, native push, watch refresh tokens ──────────────────────
  DELETE FROM push_subscriptions WHERE athlete_id = target;
  IF to_regclass('public.athlete_devices') IS NOT NULL THEN
    DELETE FROM athlete_devices WHERE athlete_id = target;  -- device_tokens cascade
  END IF;

  -- 6. Close the request ─────────────────────────────────────────────────────────
  IF to_regclass('public.account_deletion_requests') IS NOT NULL THEN
    UPDATE account_deletion_requests
       SET status = 'done', handled_at = now(), handled_by = admin_id
     WHERE athlete_id = target AND status = 'pending';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Same lock-down as 193: never callable through PostgREST by anon/authenticated.
REVOKE ALL ON FUNCTION anonymise_athlete(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  REVOKE ALL ON FUNCTION anonymise_athlete(uuid, uuid) FROM anon, authenticated;
  GRANT EXECUTE ON FUNCTION anonymise_athlete(uuid, uuid) TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
