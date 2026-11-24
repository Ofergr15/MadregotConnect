-- b23 "coach is late": a notice on the day session — how many minutes, an optional line,
-- and when it was posted. One per session: a second notice REPLACES the first, so three
-- nullable columns on the row rather than a table of notices.
--
-- Additive and safe to paste twice. Until it is pasted, lib/day-session/server.ts reads
-- and writes without these columns (OPTIONAL), and POST /api/day-session/late answers
-- 503 not_set_up.

ALTER TABLE day_sessions ADD COLUMN IF NOT EXISTS late_minutes INT;
ALTER TABLE day_sessions ADD COLUMN IF NOT EXISTS late_note TEXT;
ALTER TABLE day_sessions ADD COLUMN IF NOT EXISTS late_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE day_sessions ADD CONSTRAINT day_sessions_late_minutes_range
    CHECK (late_minutes IS NULL OR late_minutes BETWEEN 5 AND 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN day_sessions.late_minutes IS 'Coach running late by this many minutes (5-30); NULL = no notice.';
COMMENT ON COLUMN day_sessions.late_note IS 'Optional line with the late notice.';
COMMENT ON COLUMN day_sessions.late_at IS 'When the current late notice was posted.';
