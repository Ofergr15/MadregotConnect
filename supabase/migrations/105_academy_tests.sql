-- The academy's tests, and the threshold pace they exist to produce.
--
-- The academy already runs a fixed test (30 minutes all-out, or a 2000m) at intake and
-- every couple of months after it. Ofer keeps the results in Excel. Two things follow
-- from that, and this table exists to end both:
--
--   · There is no improvement graph, and there cannot be one. Ofer said it plainly:
--     "it would be very cool to have an improvement graph; that is something very hard
--     to do by hand unless you have two or three trainees." Nothing here is hard except
--     that the numbers live in a spreadsheet nobody plots.
--   · "Who has not tested in four months" is the fact the spreadsheet will not volunteer,
--     and it is the one that quietly matters: without a fresh test the trainee's paces are
--     derived from data that is months stale, so the plan is written for a slower runner
--     than the one running it.
--
-- WHY NOT `benchmark_results`. That table looks like the same thing and is not. It is the
-- club's RECORDS BOARD: ranked by fastest time, publicly listed, open to athlete
-- self-submission with an approval queue for anything that would enter the top three. Its
-- whole organising idea is "who is quickest". A 30-minute test has no fastest time — every
-- athlete runs exactly 30:00 — so eighteen academy tests would land on the public board as
-- eighteen identical entries, ranked meaninglessly against each other. A club record and a
-- threshold assessment are two different concepts that happen to both involve a stopwatch:
-- one is a public best-ever, the other is a private, latest-wins, plotted-over-time
-- measurement. Migration 088's lesson is about one CONCEPT living in two tables, which is
-- not this.
--
-- A test is stored as a DISTANCE and a DURATION, always both, whichever of the two the
-- protocol held fixed. That is what makes `protocol` metadata rather than a parser branch:
-- the threshold pace is duration/distance in every case, so a 30-minute test and a 2000m
-- test and whatever the club invents next all reduce through one line of arithmetic. The
-- alternative — a nullable column per protocol — is how you end up with a test whose pace
-- cannot be computed because the wrong field was filled in.

CREATE TABLE IF NOT EXISTS academy_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- The athlete-local calendar day, like every other date in the academy schema.
  test_date DATE NOT NULL,

  -- What was run: '30min', '2000m', or the club's own label. Metadata — see the header.
  -- Kept because the trend must not compare a 2000m to a 30-minute effort: they are
  -- different physiology and the pace difference between them is not improvement.
  protocol TEXT NOT NULL DEFAULT '30min',

  -- The measurement. Both always filled: seconds and meters.
  duration_sec NUMERIC NOT NULL CHECK (duration_sec > 0),
  distance_m NUMERIC NOT NULL CHECK (distance_m > 0),

  -- Average heart rate over the test, when the watch recorded one.
  --
  -- Deliberately NOT called threshold HR. The classic lab-free estimate of threshold HR
  -- is the average of the LAST TWENTY MINUTES of a 30-minute effort, and this is the
  -- average of all thirty — which is lower, because the first ten minutes include the
  -- ramp. Naming it `threshold_hr` would put a number two to five beats low into every
  -- HR-written workout for that athlete forever. The last-20 figure needs the activity's
  -- HR stream (migration 094) and is a later job.
  avg_hr INT CHECK (avg_hr IS NULL OR avg_hr BETWEEN 80 AND 230),

  -- The run this was measured from, when it came off a watch rather than a stopwatch.
  -- Nullable both ways: an intake test predates the athlete's Garmin connection, and an
  -- activity can be deleted or re-synced under a new row after the test was recorded.
  activity_id UUID REFERENCES athlete_activities(id) ON DELETE SET NULL,

  -- Why this test does NOT count toward the trend. NULL means it counts.
  --
  -- One nullable text column rather than a boolean plus a reason, because those two can
  -- disagree — an excluded test with no reason is unreviewable six months later, and a
  -- reason on a counted test is a note nobody reads. Tests get thrown out for real
  -- reasons (ran it sick, gale, wrong course, watch lost signal), and the coach's only
  -- alternative is to falsify the distance, which corrupts the very series being drawn.
  excluded_reason TEXT,

  notes TEXT,
  -- Who recorded it. An athletes row holding a staff role, as elsewhere in the academy.
  author_id UUID REFERENCES athletes(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One result per athlete per protocol per day. Two protocols on one day is legitimate
-- (a 2000m at the end of a 30-minute session); the same protocol twice is a double entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_tests_one_per_day
  ON academy_tests(athlete_id, test_date, protocol);

-- The improvement graph reads one athlete's history oldest-to-newest; the registry reads
-- the latest per athlete across the roster to answer "who is overdue".
CREATE INDEX IF NOT EXISTS idx_academy_tests_athlete
  ON academy_tests(athlete_id, test_date DESC);
CREATE INDEX IF NOT EXISTS idx_academy_tests_recent
  ON academy_tests(test_date DESC);

COMMENT ON TABLE academy_tests IS
  'Academy threshold tests. Not the club records board (benchmark_results) — that ranks '
  'best-ever times publicly; this is a private, latest-wins measurement plotted over time.';
COMMENT ON COLUMN academy_tests.protocol IS
  'What was run. The trend must never compare across protocols: a 2000m pace is faster '
  'than a 30-minute pace for the same fitness, and that gap is not improvement.';
COMMENT ON COLUMN academy_tests.avg_hr IS
  'Average HR over the WHOLE test, not threshold HR — threshold HR is the last 20 minutes '
  'of a 30-minute effort and runs several beats higher. See lib/academy/tests.ts.';
COMMENT ON COLUMN academy_tests.excluded_reason IS
  'Non-null excludes this test from the trend, and says why. NULL means it counts.';

-- Verify.
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'academy_tests') AS columns,
  (SELECT count(*) FROM academy_tests) AS rows;
