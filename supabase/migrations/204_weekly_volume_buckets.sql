-- 204: weekly_volume_buckets — fetchWeeklyVolume's bucketing done in the database.
--
-- lib/athletes/weekly-volume.ts used to page every qualifying activity of a roster
-- (2772 rows for 25 athletes over 26 weeks) through the function, 1000 rows a round
-- trip, Vercel (iad1) to the DB (Tokyo). This returns at most athletes × weeks rows
-- in ONE trip. The app falls back to the paged read when this function is missing,
-- so pasting it is optional and order-free.
--
-- Must agree exactly with the JS path (pinned by src/__tests__/weeklyVolumeRpc.test.ts):
--  * Week key from the WALL-CLOCK date: start_time holds Garmin's startTimeLocal in a
--    timestamptz, i.e. UTC-shaped, so read it AT TIME ZONE 'UTC' — never in the
--    session/viewer zone (CLAUDE.md "Activity timestamps are UTC-shaped").
--  * Week anchor p_start_day as Date.getDay(): 1 = Monday (activity week, default),
--    0 = Sunday (only for one athlete's own preference, migration 119).
--  * Qualifying runs = filterQualifyingRuns: distance > 0, duration > 0, and an
--    activity_type that is empty or one of p_run_types (passed from PR_RUN_TYPES so
--    the list cannot drift between SQL and TS).
--  * Lower bound is the same `start_time >= '<axis[0]>'` text comparison PostgREST
--    made. Weeks past the axis are dropped by the caller, as before.
--
-- Service role only: it reads any athlete's km, so no anon/authenticated EXECUTE.

CREATE OR REPLACE FUNCTION weekly_volume_buckets(
  p_athlete_ids uuid[],
  p_since text,
  p_start_day int DEFAULT 1,
  p_run_types text[] DEFAULT ARRAY['running']
)
RETURNS TABLE (
  athlete_id uuid,
  week_start date,
  meters numeric,
  runs bigint,
  seconds numeric,
  climb_m numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    a.athlete_id,
    ((a.start_time AT TIME ZONE 'UTC')::date
      - ((EXTRACT(DOW FROM (a.start_time AT TIME ZONE 'UTC'))::int - p_start_day + 7) % 7)) AS week_start,
    SUM(a.distance) AS meters,
    COUNT(*) AS runs,
    SUM(COALESCE(a.duration, 0)) AS seconds,
    SUM(COALESCE(a.elevation_gain, 0)) AS climb_m
  FROM athlete_activities a
  WHERE a.athlete_id = ANY (p_athlete_ids)
    AND a.start_time >= p_since::timestamptz
    AND a.distance > 0
    AND a.duration > 0
    AND (a.activity_type IS NULL OR a.activity_type = '' OR a.activity_type = ANY (p_run_types))
  GROUP BY 1, 2
$$;

REVOKE ALL ON FUNCTION weekly_volume_buckets(uuid[], text, int, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION weekly_volume_buckets(uuid[], text, int, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION weekly_volume_buckets(uuid[], text, int, text[]) TO service_role;
