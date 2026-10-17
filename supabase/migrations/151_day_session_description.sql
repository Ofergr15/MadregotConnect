-- "אימון ליום אחד" · "הערות לאימון": the coach's free-text notes for the session, shown
-- on the feed card. OPTIONAL until pasted: lib/day-session/server.ts reads and writes
-- without the column when it is missing (the notes are just not kept).

ALTER TABLE day_sessions ADD COLUMN IF NOT EXISTS description TEXT;
NOTIFY pgrst, 'reload schema';
