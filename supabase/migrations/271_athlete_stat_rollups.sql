-- 271_athlete_stat_rollups.sql — task 101. FILE ONLY, paste by hand, AFTER 270.
-- Design: docs/profile-rollups.md. Read by lib/athletes/stat-rollups.ts behind PROFILE_STAT_ROLLUPS=1.
--
-- Profile totals (all-time, per calendar year, per calendar month) precomputed from
-- athlete_activities — never from weekly_km_snapshots (CLAUDE.md: its week anchor changed
-- mid-history). Same qualifying-run rule as filterQualifyingRuns / migration 206: distance > 0,
-- duration > 0, activity_type empty or in p_run_types. Year/month come from the WALL-CLOCK date
-- (start_time is UTC-shaped, read AT TIME ZONE 'UTC').
--
-- Freshness is exact: a row set is valid only while computed_at >= athletes.activities_changed_at
-- (migration 270's trigger). The sync refreshes stale athletes; the reader ignores stale ones.
-- Idempotent. Service role only.

CREATE TABLE IF NOT EXISTS athlete_stat_rollups (
  athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  period      text NOT NULL,          -- 'all' | 'YYYY' | 'YYYY-MM'
  meters      numeric NOT NULL DEFAULT 0,
  seconds     numeric NOT NULL DEFAULT 0,
  runs        integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, period)
);

ALTER TABLE athlete_stat_rollups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON athlete_stat_rollups FROM anon, authenticated;

CREATE OR REPLACE FUNCTION refresh_athlete_stat_rollups(p_athlete_ids uuid[], p_run_types text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  stamp timestamptz := clock_timestamp();
BEGIN
  DELETE FROM athlete_stat_rollups WHERE athlete_id = ANY (p_athlete_ids);
  INSERT INTO athlete_stat_rollups (athlete_id, period, meters, seconds, runs, computed_at)
  SELECT q.athlete_id, p.period, SUM(q.distance), SUM(COALESCE(q.duration, 0)), COUNT(*), stamp
  FROM (
    SELECT a.athlete_id, a.distance, a.duration, (a.start_time AT TIME ZONE 'UTC') AS wall
    FROM athlete_activities a
    WHERE a.athlete_id = ANY (p_athlete_ids)
      AND a.distance > 0 AND a.duration > 0
      AND (a.activity_type IS NULL OR a.activity_type = '' OR a.activity_type = ANY (p_run_types))
  ) q
  CROSS JOIN LATERAL (VALUES ('all'), (to_char(q.wall, 'YYYY')), (to_char(q.wall, 'YYYY-MM'))) AS p(period)
  GROUP BY q.athlete_id, p.period;
  -- An athlete with no qualifying runs still gets an 'all' row, so "0 km" is fresh, not missing.
  INSERT INTO athlete_stat_rollups (athlete_id, period, computed_at)
  SELECT id, 'all', stamp FROM unnest(p_athlete_ids) AS id
  ON CONFLICT (athlete_id, period) DO NOTHING;
  RETURN cardinality(p_athlete_ids);
END;
$$;

-- The sync's one call: every athlete whose activities changed after their rollup (or who has none).
CREATE OR REPLACE FUNCTION refresh_stale_athlete_stat_rollups(p_run_types text[], p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM (
    SELECT a.id
    FROM athletes a
    LEFT JOIN athlete_stat_rollups r ON r.athlete_id = a.id AND r.period = 'all'
    WHERE a.activities_changed_at IS NOT NULL
      AND (r.computed_at IS NULL OR r.computed_at < a.activities_changed_at)
    ORDER BY a.activities_changed_at
    LIMIT p_limit
  ) s;
  IF ids IS NULL THEN RETURN 0; END IF;
  RETURN refresh_athlete_stat_rollups(ids, p_run_types);
END;
$$;

REVOKE ALL ON FUNCTION refresh_athlete_stat_rollups(uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refresh_stale_athlete_stat_rollups(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_athlete_stat_rollups(uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION refresh_stale_athlete_stat_rollups(text[], integer) TO service_role;

-- Backfill: give every athlete a stamp so the sync's stale scan picks them all up (50 per tick).
-- Only touches NULLs, so a second paste changes nothing.
UPDATE athletes SET activities_changed_at = now() WHERE activities_changed_at IS NULL;
