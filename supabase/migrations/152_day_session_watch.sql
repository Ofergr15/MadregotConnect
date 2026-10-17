-- "אימון ליום אחד" · "לשלוח לשעונים": the Garmin ids a send created, per athlete, so the
-- next send replaces them instead of adding a second copy. OPTIONAL until pasted:
-- lib/day-session/watch.ts sends without it (a re-send then duplicates).
ALTER TABLE day_sessions ADD COLUMN IF NOT EXISTS watch_deliveries JSONB;
NOTIFY pgrst, 'reload schema';
