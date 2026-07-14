-- Per-step lap data for activities (separate from the per-km `splits` used by the
-- activity charts). Garmin auto-creates one lap per executable step when the athlete
-- runs a pushed structured workout on-watch, so laps ≈ planned steps — the basis for
-- per-segment planned-vs-actual verdicts in the Academy compliance drill-down.
ALTER TABLE athlete_activities ADD COLUMN IF NOT EXISTS laps JSONB;
