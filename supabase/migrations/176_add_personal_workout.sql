-- 176: hand-written personal workouts for ONE athlete (2026-11-01).
--
--   select add_personal_workout('runner@example.com', '2026-11-01', $json$[ {ParsedWorkout}, ... ]$json$);
--
-- Writes that athlete's own weekly_plans row for the week holding p_date (weeks start on
-- Sunday): the club's week for that Sunday, with every day named in p_workouts replaced by
-- the given workouts, in every pace group. The blob is flagged "manual": true, which makes
-- the app show it to the athlete even outside the academy (lib/plans/scope-server.ts) and
-- makes "send to watch" (/api/my-watch) send it instead of the club week. Nobody else sees it.
-- Calling it again for the same athlete and week replaces their manual row.
-- Returns the plan id. Raises when the email matches no athlete.

CREATE OR REPLACE FUNCTION add_personal_workout(p_email text, p_date date, p_workouts jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_coach uuid := '30f056a7-c651-490e-8356-615ea9eff097';
  v_athlete uuid;
  v_week date := p_date - extract(dow FROM p_date)::int;
  v_days int[];
  v_club jsonb;
  v_blob jsonb;
  v_key text;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p_workouts) <> 'array' OR jsonb_array_length(p_workouts) = 0 THEN
    RAISE EXCEPTION 'add_personal_workout: p_workouts must be a non-empty JSON array of workouts';
  END IF;

  SELECT id INTO v_athlete FROM athletes WHERE lower(email) = lower(btrim(p_email));
  IF v_athlete IS NULL THEN
    RAISE EXCEPTION 'add_personal_workout: no athlete with email %', p_email;
  END IF;

  SELECT array_agg(DISTINCT (w->>'dayOfWeek')::int) INTO v_days FROM jsonb_array_elements(p_workouts) w;

  SELECT parsed_workouts INTO v_club FROM weekly_plans
  WHERE coach_id = v_coach AND week_start_date = v_week AND athlete_id IS NULL
  ORDER BY status DESC, created_at DESC LIMIT 1;

  v_blob := COALESCE(v_club, jsonb_build_object('workouts', '[]'::jsonb));
  FOREACH v_key IN ARRAY ARRAY['workouts', 'group1', 'group2', 'group3'] LOOP
    IF v_key = 'workouts' AND jsonb_typeof(v_blob->'workouts') = 'array' THEN
      v_blob := jsonb_set(v_blob, '{workouts}', COALESCE((
        SELECT jsonb_agg(w) FROM jsonb_array_elements(v_blob->'workouts') w
        WHERE NOT ((w->>'dayOfWeek')::int = ANY (v_days))), '[]'::jsonb) || p_workouts);
    ELSIF v_key <> 'workouts' AND jsonb_typeof(v_blob->v_key->'workouts') = 'array' THEN
      v_blob := jsonb_set(v_blob, ARRAY[v_key, 'workouts'], COALESCE((
        SELECT jsonb_agg(w) FROM jsonb_array_elements(v_blob->v_key->'workouts') w
        WHERE NOT ((w->>'dayOfWeek')::int = ANY (v_days))), '[]'::jsonb) || p_workouts);
    END IF;
  END LOOP;
  v_blob := v_blob || jsonb_build_object('manual', true);

  DELETE FROM weekly_plans
  WHERE athlete_id = v_athlete AND week_start_date = v_week AND (parsed_workouts->>'manual') = 'true';

  INSERT INTO weekly_plans (coach_id, athlete_id, week_start_date, original_input, parsed_workouts, status)
  VALUES (v_coach, v_athlete, v_week, 'add_personal_workout', v_blob, 'draft')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- SQL editor / migrations only: never callable through the REST API (/rest/v1/rpc).
REVOKE ALL ON FUNCTION add_personal_workout(text, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_personal_workout(text, date, jsonb) FROM anon, authenticated;
