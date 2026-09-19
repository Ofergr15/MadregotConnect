-- The academy's workout book, and the reason it cannot store a pace.
--
-- The academy rewrites the same 30-40 sessions over and over with different numbers on
-- them. The mockup's own build-order note says the book saves the most writing time of
-- anything left, for the same economic reason the feedback form saved the most reading
-- time: "duplicate, small edit, push to 6 trainees - three clicks instead of writing from
-- scratch".
--
-- WHAT MAKES IT A BOOK RATHER THAN A FOLDER. An entry is stored WITHOUT absolute paces.
-- It holds an intensity - threshold pace, or 92% of threshold - and the real pace is
-- derived per trainee from that trainee's own measured threshold (academy_tests, migration
-- 105). That is the whole point: a session saved as 4:05/km is a session for one runner
-- and a mistake for everyone else, so it would have to be rewritten per trainee, which is
-- exactly the work the book exists to remove. Stored relatively, one entry serves band 4
-- and band 9 at once.
--
-- The percentage is of SPEED, not of seconds per km. 92% of a 5:00 threshold is 5:26, not
-- 4:36 - see lib/academy/library.ts, which is the only place that arithmetic is written.
--
-- TWO SHELVES, because "is the book yours or the academy's" is a question about roles and
-- this schema should not pre-empt it. `scope = 'mine'` is a coach's own shelf, writable by
-- them; `scope = 'academy'` is the canon. Who may write to the canon is enforced on the
-- route, not here, so changing that decision later is a one-line change and not a
-- migration.
--
-- NO PACES HERE, and it is not enforceable by a CHECK: the steps are JSONB and the
-- invariant is about which keys are absent inside them. lib/academy/library.ts has
-- `hasAbsolutePaces`, the save route refuses on it, and there is a test per smuggling
-- route (a top-level field, one nested in a repeat, and one written into a step note -
-- the Garmin converter prints a note verbatim on the watch when it contains a pace).

CREATE TABLE IF NOT EXISTS academy_workout_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 'mine' | 'academy'. See the header.
  scope TEXT NOT NULL DEFAULT 'mine' CHECK (scope IN ('mine', 'academy')),

  -- The coach who wrote it. An athletes row holding a staff role, as everywhere else in
  -- the academy schema.
  --
  -- Nullable, and SET NULL rather than CASCADE, so the canon survives its author leaving:
  -- a session the academy has pushed 28 times must not disappear because a mentor's row
  -- was removed. A 'mine' entry whose owner is gone becomes invisible instead, which is
  -- the right outcome - nobody else ever had it.
  owner_id UUID REFERENCES athletes(id) ON DELETE SET NULL,

  name TEXT NOT NULL,

  -- The mockup's six filter chips: intervals / tempo / long / easy / hills / test.
  -- One column and not a tag array: the chips are a single-choice filter on that screen,
  -- and a session is one kind of session. Kept in step with LIBRARY_KINDS in
  -- lib/academy/library.ts.
  kind TEXT NOT NULL DEFAULT 'easy'
    CHECK (kind IN ('intervals', 'tempo', 'long', 'easy', 'hills', 'test')),

  -- The coach's note on the session. Never a pace - see the header.
  notes TEXT,

  -- The steps, in the shape of ParsedWorkout.steps minus every pace field, plus an
  -- `intensity: { fastPct, slowPct }` on the steps that ask for an effort.
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- How many trainee-pushes this entry has produced, and when the last one was.
  --
  -- Not decoration: the book is ordered by frequency of use, because three clicks only
  -- beats writing if the session you want is at the top of the list. `last_used_at` breaks
  -- the tie so a shelf of brand-new entries still has a stable order.
  use_count INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at TIMESTAMPTZ,

  -- Soft delete. A session that has been pushed 28 times is the academy's institutional
  -- memory, and the undo for a mis-tap on a list row has to exist somewhere.
  archived_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One name per shelf per owner, among the live entries. The duplicate button is one tap
-- next to the entry it copies, so saving the same session twice by accident is the likely
-- mistake, not a deliberate second version. Case-insensitive because the only thing worse
-- than two identical entries is two that differ by a capital letter.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_library_one_name
  ON academy_workout_library(owner_id, scope, lower(name))
  WHERE archived_at IS NULL;

-- The list screen's own query: a shelf, most-used first.
CREATE INDEX IF NOT EXISTS idx_academy_library_shelf
  ON academy_workout_library(scope, use_count DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_academy_library_owner
  ON academy_workout_library(owner_id)
  WHERE archived_at IS NULL;

COMMENT ON TABLE academy_workout_library IS
  'The academy workout book. Entries store RELATIVE intensities (percent of threshold '
  'speed), never absolute paces, so one entry serves every goal band - the pace is '
  'derived per trainee from academy_tests. See lib/academy/library.ts.';
COMMENT ON COLUMN academy_workout_library.steps IS
  'ParsedWorkout.steps minus every pace field, plus intensity {fastPct,slowPct} as a '
  'percent of threshold SPEED (92 is SLOWER than threshold, not faster).';
COMMENT ON COLUMN academy_workout_library.scope IS
  'mine = the coach''s own shelf; academy = the canon. Write permission on the canon is '
  'enforced on the route, not here.';
COMMENT ON COLUMN academy_workout_library.use_count IS
  'Trainee-pushes produced by this entry. The book is ordered by it.';

-- Verify.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'academy_workout_library') AS columns,
  (SELECT count(*) FROM pg_indexes
     WHERE tablename = 'academy_workout_library') AS indexes,
  (SELECT count(*) FROM academy_workout_library) AS rows;
