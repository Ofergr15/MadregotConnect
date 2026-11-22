-- 197: coach-marked presence per athlete per practice day.
-- Separate from the athlete's own RSVP (POST /api/attendance): this is what the
-- coach saw, written by PUT /api/attendance/presence (staff only, JWT-verified).
-- Paste by hand into the Supabase SQL editor; nothing applies it automatically.
-- Two keys to athletes (athlete_id, marked_by): any embed between the two tables
-- must be hinted, e.g. athletes!athlete_id(name).

CREATE TABLE IF NOT EXISTS practice_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,            -- the SUNDAY plan week
  day SMALLINT NOT NULL CHECK (day BETWEEN 0 AND 6),
  group_label TEXT,
  present BOOLEAN NOT NULL,
  marked_by UUID REFERENCES athletes(id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, week_start, day)
);

CREATE INDEX IF NOT EXISTS practice_presence_week_idx ON practice_presence (week_start, day);

ALTER TABLE practice_presence ENABLE ROW LEVEL SECURITY;
