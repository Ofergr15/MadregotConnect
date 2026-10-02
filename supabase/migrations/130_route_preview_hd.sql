-- Sharper route thumbnails, on trial for a few runners first (PR #12).
--
-- Migration 047's route_preview keeps every (n / 60)th GPS point: on a 2-hour run
-- one point every ~500 m, so curves become chords and laps in a park a jagged
-- star. This adds route_preview_hd beside it: 300 evenly spaced points, the true
-- start and finish always kept, coordinates rounded to 5 decimals (~1 m), points
-- without numeric lat/lng skipped so the trigger can never throw. route_preview
-- itself is untouched, so everyone outside the trial gets exactly what they got.
--
-- Who is on the trial: app_settings 'route_hd_testers', a JSON list of athlete
-- ids (lib/feed/route-hd.ts). Spacing stays even on purpose — paceSegments()
-- places each kilometre's colour band by point count.

ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS route_preview_hd JSONB;

CREATE OR REPLACE FUNCTION downsample_route_hd(pts JSONB, target INT DEFAULT 300)
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

CREATE OR REPLACE FUNCTION sync_route_preview() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.route_preview := downsample_route(NEW.gps_points);
    NEW.route_preview_hd := downsample_route_hd(NEW.gps_points);
  ELSIF NEW.gps_points IS DISTINCT FROM OLD.gps_points THEN
    NEW.route_preview := downsample_route(NEW.gps_points);
    NEW.route_preview_hd := downsample_route_hd(NEW.gps_points);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE athlete_activities
   SET route_preview_hd = downsample_route_hd(gps_points)
 WHERE gps_points IS NOT NULL;
