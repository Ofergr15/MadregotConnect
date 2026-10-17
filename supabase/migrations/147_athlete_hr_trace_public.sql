-- Whether club members see this runner's second-by-second heart rate on the run page.
--
-- The run page now draws the 1 Hz Garmin trace (GET /api/activities/stream) instead of
-- per-km dots. Pace, elevation and cadence are club-visible like the route already is;
-- the heart-rate LINE is new exposure — until now teammates saw only per-km averages.
-- Ofer's call (2026-10-17): visible to the club by default, with a per-runner switch in
-- Settings > Personal info > Privacy. The runner and staff always see their own.
--
-- The per-run "hide heart rate" toggle in the share sheet (feed_items.payload.hiddenFields)
-- also hides the trace for that one run; this column is the runner-wide default.
--
-- OPTIONAL until pasted: lib/athletes/hr-trace-privacy.ts reads a missing column as TRUE
-- (the default this file sets), and a save of the switch answers 503 until it exists.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS hr_trace_public BOOLEAN NOT NULL DEFAULT TRUE;
