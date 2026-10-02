-- Sharper route thumbnails on feed cards.
--
-- Migration 047's downsample_route() kept every (n / 60)th GPS point. On a 2-hour
-- run that is one point every ~500 m, so curves became straight chords and laps in
-- a park drew as a jagged star. It could also drop the true finish point, putting
-- the end marker short of where the run actually ended.
--
-- Now: 300 evenly spaced points, first and last always kept, coordinates rounded
-- to 5 decimals (~1 m). Spacing stays even on purpose — paceSegments() places each
-- kilometre's colour band by fraction of the point count, so a shape-based
-- simplifier (Douglas-Peucker) would put the bands in the wrong places.
--
-- Points without numeric lat/lng are skipped rather than cast, so a bad row can
-- never make the trg_route_preview INSERT/UPDATE trigger throw.
--
-- Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION downsample_route(pts JSONB, target INT DEFAULT 300)
RETURNS JSONB AS $$
DECLARE
  n INT;
  k INT;
BEGIN
  IF pts IS NULL OR jsonb_typeof(pts) <> 'array' THEN RETURN NULL; END IF;
  n := jsonb_array_length(pts);
  IF n = 0 THEN RETURN '[]'::jsonb; END IF;
  k := LEAST(n, GREATEST(2, target));
  RETURN COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'lat', round((p ->> 'lat')::numeric, 5)::float8,
                'lng', round((p ->> 'lng')::numeric, 5)::float8
              ) ORDER BY i)
       FROM generate_series(0, k - 1) AS i,
            LATERAL (SELECT pts -> CASE WHEN k = 1 THEN 0
                                        ELSE round(i::numeric * (n - 1) / (k - 1))::int
                                   END AS p) s
      WHERE jsonb_typeof(p -> 'lat') = 'number'
        AND jsonb_typeof(p -> 'lng') = 'number'),
    '[]'::jsonb
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Rebuild existing previews. The trigger only fires on gps_points changes, so this
-- touches route_preview alone.
UPDATE athlete_activities
   SET route_preview = downsample_route(gps_points)
 WHERE gps_points IS NOT NULL;
