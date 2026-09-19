-- ════════════════════════════════════════════════════════════════════════════════════════
-- 113 — THE TEST ANALYSIS: the coach's decision about a measurement
-- ════════════════════════════════════════════════════════════════════════════════════════
--
-- Funnel step 8, and the mockup's own note about it is the whole brief: "ניתוח הטסט + סיכום
-- כתוב; הניתוח נותן את האינדיקציה מי הוא" — manual, Ofer, and marked "here there is a lot to
-- take". Today a test result becomes a threshold, a band and a written summary inside one
-- person's head and one spreadsheet. Nothing about the arithmetic is hard; what is missing is
-- a place for the DECISION.
--
-- ── WHY THIS IS NOT COLUMNS ON academy_tests ────────────────────────────────────────────
--
-- Because a test is a measurement and an analysis is an opinion, and they have different
-- authors, different lifetimes and different truth conditions. The measurement is 6.42 km in
-- 30 minutes and it never changes. The analysis says "this is a band 6 runner, their threshold
-- is 4:52/km, and the first two weeks will be easy" — a judgement a coach makes, edits, and
-- may make differently a year later with the same numbers in front of them.
--
-- Putting them in one row would also mean every read of the trend carries the summary text,
-- and every correction to the arithmetic looks like a correction to the measurement.
--
-- ── WHY BOTH derived AND approved ARE STORED ────────────────────────────────────────────
--
-- `derived` is what the code computed at the moment of approval. `approved` is what the coach
-- signed. They are usually identical, and the two cases where they are not are the reason this
-- table exists at all:
--
--   1. The coach edited a number. A trainee who ran the test on a hilly course, or was
--      recovering, gets the threshold their coach believes rather than the one the formula
--      produced — and that edit must survive, not be recomputed away on the next page load.
--   2. The formula changed. The coefficients in lib/academy/testAnalysis.ts are the app's
--      current best guess and will be replaced by Ofer's own table. When they change, every
--      past analysis must keep the numbers the athlete was actually trained on; a stored
--      threshold is what a plan was written against, and silently re-deriving it six months
--      later rewrites history. Keeping `derived` beside it is what makes the difference
--      auditable instead of invisible.
--
-- JSONB rather than a column per metric for one reason: the metric list is not settled. It is
-- five rows today (threshold pace, threshold HR, easy, interval, predicted marathon) and Ofer
-- maintains a wider table by hand — 1500 up to marathon — which this screen is meant to
-- absorb. A column per metric would make each of those a migration; the shape is defined and
-- validated in one place in TypeScript instead.
--
-- ── THE BAND IS THE POINT ───────────────────────────────────────────────────────────────
--
-- `recommended_band_id` is the machine's suggestion and `band_id` is the coach's answer, and
-- they are stored separately even when they agree. "You went with the recommendation" and "you
-- overrode it" are the only data that will ever say whether the recommendation is any good,
-- and a single column would throw that away at the moment of the tap. The mockup promises the
-- coach exactly this in words: "עברת עליה או שינית? השינוי שלך גובר, והמערכת זוכרת שזו החלטה
-- שלך".
--
-- Note that the assignment itself still lives on athletes.academy_band_id (migration 077) —
-- that is what the planner reads, and this table must never become a second answer to "which
-- band is this trainee in". This is the record of the decision; that column is its effect.

CREATE TABLE IF NOT EXISTS academy_test_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- One analysis per test. A second opinion about the same measurement is an EDIT of this row,
  -- not another row: two analyses of one test are two thresholds, and nothing downstream could
  -- say which one the trainee is running on.
  test_id UUID NOT NULL UNIQUE REFERENCES academy_tests(id) ON DELETE CASCADE,

  -- Denormalised from the test, on purpose. "What thresholds is this trainee training on" is a
  -- question asked by the plan composer and by the athlete's own screen, and neither of them
  -- wants a join through the test registry to answer it.
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

  -- What the code computed, and what the coach signed. See the header.
  derived JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- The machine's suggestion and the human's answer, kept apart even when equal.
  recommended_band_id UUID REFERENCES academy_bands(id) ON DELETE SET NULL,
  band_id UUID REFERENCES academy_bands(id) ON DELETE SET NULL,

  -- The words the trainee receives. Drafted by the app, edited by the coach, and stored as
  -- what was actually said: the summary is the part of this screen the trainee reads, and a
  -- club that cannot look up what it told somebody three months ago is back to WhatsApp.
  summary TEXT,

  -- 'draft'    — the app prepared it, or the coach saved it half-finished. Changes nothing.
  -- 'approved' — the coach signed it. This is the transition that assigns the band and lets a
  --              plan be written; everything before it is reversible and invisible to the
  --              trainee.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved')),

  -- Staff, as an athletes row holding a staff role, as elsewhere in the academy.
  author_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An approved analysis with no timestamp cannot be aged, and "when were this athlete's
  -- thresholds set" is the question the whole staleness clock is built on.
  CONSTRAINT academy_test_analyses_approved_has_time
    CHECK (status <> 'approved' OR approved_at IS NOT NULL),

  -- An approved analysis with no numbers is a signature on a blank page. The band may be
  -- absent (a coach can approve thresholds and leave the assignment for later) but the
  -- thresholds may not.
  CONSTRAINT academy_test_analyses_approved_has_numbers
    CHECK (status <> 'approved' OR approved <> '{}'::jsonb)
);

-- "Show me this athlete's analyses, newest first" — the athlete profile, the plan composer,
-- and the check for whether the newest test has been analysed at all.
CREATE INDEX IF NOT EXISTS idx_academy_test_analyses_athlete
  ON academy_test_analyses (athlete_id, created_at DESC);

-- The manager's queue: which analyses are still waiting on a human. Partial, because drafts
-- are a handful and approved rows accumulate forever.
CREATE INDEX IF NOT EXISTS idx_academy_test_analyses_draft
  ON academy_test_analyses (created_at)
  WHERE status = 'draft';

-- Service-role only, like every academy table. No policies on purpose: without a policy anon
-- and authenticated read zero rows, and the anon key ships inside the browser bundle.
ALTER TABLE academy_test_analyses ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE academy_test_analyses IS
  'Funnel step 8. The coach opinion about a test: derived thresholds, the band decision and '
  'the written summary the trainee receives. Separate from academy_tests because a '
  'measurement never changes and an opinion does.';
COMMENT ON COLUMN academy_test_analyses.derived IS
  'What the code computed at approval time. Kept beside `approved` so that changing a '
  'coefficient later cannot silently rewrite the thresholds a plan was actually written '
  'against, and so a coach edit is visible as a difference rather than lost.';
COMMENT ON COLUMN academy_test_analyses.approved IS
  'The numbers the coach signed, which is what the planner and the trainee see. Equal to '
  '`derived` unless a number was edited.';
COMMENT ON COLUMN academy_test_analyses.recommended_band_id IS
  'The suggestion, stored even when the coach agreed with it. Whether coaches accept or '
  'override it is the only evidence that will ever say if the recommendation is any good.';
COMMENT ON COLUMN academy_test_analyses.band_id IS
  'The decision. The ASSIGNMENT still lives on athletes.academy_band_id (migration 077), '
  'which is what the planner reads; this is the record of who decided it and when.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect 0 rows, rowsecurity = true, no policies, 2 indexes, 2 CHECKs.
--
--   SELECT count(*) AS rows FROM academy_test_analyses;
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'academy_test_analyses';
--   SELECT count(*) AS policies FROM pg_policies WHERE tablename = 'academy_test_analyses';
--
-- ROLLBACK (destructive):
--   DROP TABLE IF EXISTS academy_test_analyses;
-- ───────────────────────────────────────────────────────────────────────────
