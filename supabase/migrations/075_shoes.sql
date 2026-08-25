-- Per-athlete shoe tracker — each shoe accumulates km from the athlete's own
-- activities (attributed via athlete_activities.shoe_id, stamped at sync/log
-- time from the athlete's currently-active shoe) so mileage limits and
-- retirement alerts can be computed without any manual re-entry.
CREATE TABLE IF NOT EXISTS shoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  distance_limit_km NUMERIC,
  -- How many km before the limit to send the first warning; the second
  -- alert fires at the limit itself. NULL limit = tracked but never alerts.
  alert_before_km NUMERIC NOT NULL DEFAULT 50,
  retired BOOLEAN NOT NULL DEFAULT false,
  -- One-shot idempotency flags — each alert fires at most once per shoe,
  -- reset if the athlete raises the limit past what already fired.
  alerted_near_at TIMESTAMPTZ,
  alerted_over_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shoes_athlete ON shoes(athlete_id);

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS active_shoe_id UUID REFERENCES shoes(id) ON DELETE SET NULL;
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS shoe_id UUID REFERENCES shoes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_athlete_activities_shoe ON athlete_activities(shoe_id) WHERE shoe_id IS NOT NULL;
