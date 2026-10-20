-- 163: אלופי המדרגות (mockup ~/.cache/madregot/champions, Ofer 2026-10-20): the club's
-- table per distance from OFFICIAL race times. A watch's race-day run is only a
-- suggestion (race_matches matches by day, warm-ups included), so a result counts only
-- once a staff member approved it, with the official time typed in.
-- Paste as one block in the Supabase SQL editor; safe to run twice. Service role only.
CREATE TABLE IF NOT EXISTS race_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id   UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  distance     TEXT NOT NULL CHECK (distance IN ('5k','10k','half','marathon')),
  seconds      INTEGER NOT NULL CHECK (seconds > 0),
  race_name    TEXT,
  race_date    DATE NOT NULL,
  activity_id  UUID REFERENCES athlete_activities(id) ON DELETE SET NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS race_results_distance_idx ON race_results (distance, seconds) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS race_results_activity_key ON race_results (activity_id) WHERE activity_id IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE race_results ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
