-- Academy pairing — the 1:1 relationship, the trainee's goal band, and their paces.
--
-- Training in the academy is one-on-one and coached ONLINE. There is no fixed
-- venue and no private standing appointment: a trainee either follows a plan
-- remotely, or joins the club's own team session and runs it at their own paces.
-- Which of those happens varies week to week, so it is a property of a planned
-- workout, not of a weekly booking. An earlier draft of this migration created an
-- `academy_slots` table (weekday / start_time / duration / venue) modelling a
-- private appointment; it described something the academy does not do and was
-- removed before this migration was ever applied.
--
-- What genuinely distinguishes one trainee from another is their GOAL. The public
-- registration form already asks for it — "לאיזה דבוקה תרצה להשתייך", דבוקות 4-9,
-- each one a goal rather than a pace band. Those six had nowhere to live: the
-- `groups` table holds only the club's three marathon pace bands, and an academy
-- trainee needs both (they may run with a club group and belong to a דבוקה).

-- ─────────────────────────── The pair ───────────────────────────

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS academy_coach_id UUID REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS academy_joined_on DATE;

COMMENT ON COLUMN athletes.academy_coach_id IS
  'The trainee''s dedicated academy coach — an athletes row holding a staff role. NULL = not paired yet.';
COMMENT ON COLUMN athletes.academy_joined_on IS
  'When they joined the academy, which is not when they joined the club (created_at).';

CREATE INDEX IF NOT EXISTS idx_athletes_academy_coach
  ON athletes(academy_coach_id) WHERE academy_coach_id IS NOT NULL;

-- Who coached whom, and when. Kept as its own table rather than trusting the
-- column's history: "why did this trainee's adherence fall off in April" is a
-- question about a handover, and the column only ever knows the present.
CREATE TABLE IF NOT EXISTS academy_coach_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  coach_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  started_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_on DATE,                          -- NULL = still the current pair
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_coach_history_athlete
  ON academy_coach_history(athlete_id, started_on DESC);
-- At most one open row per trainee — the invariant the assign endpoint relies on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_coach_history_open
  ON academy_coach_history(athlete_id) WHERE ended_on IS NULL;

-- ──────────────────── The goal bands (דבוקות) ────────────────────

-- Club-wide, not per-coach: a דבוקה is the academy's own definition of a goal,
-- and two coaches training sub-3 marathoners are training toward the same thing.
--
-- `pace_profile` deliberately reuses the shape already stored on `groups`
-- ({ marathonGoal, offsetSeconds, level }) so the planner can read a band's paces
-- through exactly the same code path as a club group's. `offsetSeconds` is
-- seconds per km added to the workout's written pace.
CREATE TABLE IF NOT EXISTS academy_bands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- The number the trainee actually says out loud ("I'm in דבוקה 7").
  band_number INT NOT NULL,
  name TEXT NOT NULL,
  -- The goal in the academy's own words, as the registration form phrases it.
  goal TEXT,
  pace_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_bands_number ON academy_bands(band_number);
CREATE INDEX IF NOT EXISTS idx_academy_bands_active ON academy_bands(sort_order) WHERE active;

COMMENT ON COLUMN academy_bands.pace_profile IS
  'Same shape as groups.pace_profile: { marathonGoal, offsetSeconds, level }. offsetSeconds is sec/km added to the written pace; absent means the paces for this band have not been set yet and the planner must refuse to re-pace.';

-- Seeded from the live registration form's own wording so the bands a trainee
-- picked at signup are the bands the manager sees.
--
-- offsetSeconds is deliberately LEFT UNSET on every row. The club's three groups
-- are 0/+15/+30 relative to a sub-2:30 group; these six span sub-3 to
-- absolute-beginner, and guessing the spread would push invented paces onto real
-- athletes' watches. Each band's offset is set once, in the academy settings, by
-- someone who coaches them.
INSERT INTO academy_bands (band_number, name, goal, pace_profile, sort_order) VALUES
  (4, 'דבוקה 4', 'מרתון חזק עם רצון לסאב 3',           '{"marathonGoal": "SUB 3:00"}'::jsonb, 40),
  (5, 'דבוקה 5', 'אימון למרתון באזור ה-3:30',           '{"marathonGoal": "SUB 3:30"}'::jsonb, 50),
  (6, 'דבוקה 6', 'ביצוע מרתון מלא בכל תוצאה',           '{"marathonGoal": "MARATHON"}'::jsonb,  60),
  (7, 'דבוקה 7', 'הכנה לחצי מרתון',                     '{"marathonGoal": "HALF"}'::jsonb,      70),
  (8, 'דבוקה 8', 'שיפור הישגים למרחקים קצרים 5 ק"מ 10 ק"מ', '{"marathonGoal": "5K / 10K"}'::jsonb, 80),
  (9, 'דבוקה 9', 'אימון למתחילים מ-0',                   '{"marathonGoal": "BEGINNER"}'::jsonb,  90)
ON CONFLICT (band_number) DO NOTHING;

-- ───────────── The trainee's band, and their own paces ─────────────

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS academy_band_id UUID REFERENCES academy_bands(id) ON DELETE SET NULL;

-- The per-athlete override. NULL means "use the band's offset" — which is the
-- normal case, and the reason this is nullable rather than defaulting to 0: a
-- stored 0 would be indistinguishable from a coach deciding this athlete runs
-- exactly at band pace, and the band's own offset could then never move them.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS academy_pace_offset_sec INT;

ALTER TABLE athletes DROP CONSTRAINT IF EXISTS athletes_academy_pace_offset_sec_range;
ALTER TABLE athletes ADD CONSTRAINT athletes_academy_pace_offset_sec_range
  CHECK (academy_pace_offset_sec IS NULL OR academy_pace_offset_sec BETWEEN -120 AND 600);

COMMENT ON COLUMN athletes.academy_band_id IS
  'The trainee''s goal band (דבוקה). Separate from group_id, which is the club''s marathon pace band — a trainee can have both.';
COMMENT ON COLUMN athletes.academy_pace_offset_sec IS
  'Per-athlete override of the band''s pace offset, in seconds per km. NULL = follow the band.';

CREATE INDEX IF NOT EXISTS idx_athletes_academy_band
  ON athletes(academy_band_id) WHERE academy_band_id IS NOT NULL;
