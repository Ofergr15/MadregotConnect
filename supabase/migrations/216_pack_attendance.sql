-- 216: per-pack session attendance (flag academy_pack_attendance).
-- Separate from practice_presence (197, the coach's club-wide marks keyed by plan week/day):
-- this one is per pack per date, carries WHO decided (source 'watch' = an activity within
-- ±90 min of the session, 'leader' = the leader's mark, which always wins), and is editable
-- until 12:00 Israel the next day (enforced in POST /api/packs/:id/attendance).
--
-- One key to athletes only (athlete_id); marked_by and pack_id carry no FK on purpose
-- (schemaEmbedAmbiguity.test.ts). Paste by hand. Idempotent.

CREATE TABLE IF NOT EXISTS pack_attendance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id      UUID NOT NULL,
  session_date DATE NOT NULL,
  athlete_id   UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  source       TEXT NOT NULL CHECK (source IN ('watch', 'leader')),
  watch_note   TEXT,
  marked_by    UUID,
  marked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pack_id, session_date, athlete_id)
);
CREATE INDEX IF NOT EXISTS pack_attendance_pack_date_idx ON pack_attendance (pack_id, session_date);

ALTER TABLE pack_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pack_attendance FROM anon, authenticated;
GRANT ALL ON TABLE pack_attendance TO service_role;
