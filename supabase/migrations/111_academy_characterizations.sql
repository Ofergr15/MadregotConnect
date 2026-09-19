-- The characterization call, as answers rather than as a memory.
--
-- Step 3 of the intake funnel (migration 110) is a phone call: the coach asks what the person
-- wants, what they run today, which mornings they have, and what hurts. Right now those
-- answers exist in whatever the coach wrote down during the call, and two weeks later the
-- first training plan is built from recollection. The mockup is blunt about what this form is:
-- "הטופס הזה הוא גם הקלט לתוכנית הראשונה" — available days, the physical limitation and the
-- race date flow straight into the plan composer.
--
-- ── WHY TYPED COLUMNS AND NOT ONE JSONB BLOB ─────────────────────────────────────────────
--
-- A questionnaire is the classic case FOR a blob: the questions change, and every change is
-- otherwise a migration. It is the wrong call here because these answers are not survey data
-- to be reported on later — they are INPUTS. `available_days` decides which days the first
-- plan has workouts on, `target_race_date` decides how many weeks there are to build, and
-- `limitations` is the sentence that keeps somebody off intervals for a month. A blob makes
-- every one of those a runtime cast with no floor under it: `weekly_km` arrives as the string
-- "35 ק״מ", nothing complains, and the plan is built on NaN.
--
-- The compromise, so a new question is not a migration either: only the fields that FEED
-- something are columns. Anything the coach merely wants to remember goes in the free-text
-- `notes` on the funnel event (migration 110), which already exists for exactly that.
--
-- ── WHY ONE ROW PER CANDIDATE AND NOT ONE PER CALL ───────────────────────────────────────
--
-- The call happens once, and the form is filled DURING it — the mockup's footer says
-- `נשמר אוטומטית`, so a half-filled row is the normal state for twenty minutes. That means
-- upsert-on-candidate, not insert: a second save must correct the first answer rather than
-- create a second opinion about which days somebody can run. The funnel event is what records
-- that the call happened and when; this table records what was said.

CREATE TABLE IF NOT EXISTS academy_characterizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- UNIQUE, because this is the candidate's answers and not a log of attempts. CASCADE so
  -- deleting a candidate who never joined does not leave their injuries behind.
  candidate_id UUID NOT NULL UNIQUE REFERENCES academy_candidates(id) ON DELETE CASCADE,

  -- What they want: 'half' | 'full' | '10k' | 'fitness'. No CHECK, same reasoning as the
  -- funnel's stage keys — the four choices are product, they live in
  -- `lib/academy/characterization.ts` with the tests, and the fifth one (a trail race, an
  -- ultra) must not need a migration. An unknown value reads as "no answer" rather than
  -- being trusted.
  goal_type TEXT,

  -- The race itself, in the trainee's words ("טבריה"), and the day it is run. The date is
  -- DATE and not TIMESTAMPTZ: a race is a calendar day in Israel, and storing it as an
  -- instant is how "10.01.27" becomes the 9th for anybody reading in UTC.
  target_race TEXT,
  target_race_date DATE,

  -- Where they are today. Kilometres per week and years of running: the two numbers that
  -- decide whether the first week is 25k or 60k.
  weekly_km NUMERIC(5,1),
  years_running NUMERIC(3,1),

  -- Which days they can train, as weekday numbers 0=Sunday … 6=Saturday — the same encoding
  -- as `Date#getDay`, so no translation layer sits between this and the calendar. An ARRAY
  -- and not seven booleans: the plan composer wants the set, and seven columns would need
  -- seven reads and a migration to add a day that does not exist.
  available_days SMALLINT[],

  -- The ONE free-text field in the form, and the mockup is explicit that it is the only one:
  -- everything else is a choice so the form can be filled while the call is happening.
  -- It is free text because the useful answers are sentences — "דלקת בגיד אכילס לפני חצי
  -- שנה" is a training decision, and no category captures it.
  limitations TEXT,

  -- What they already own, which decides whether there is heart-rate data at all.
  watch TEXT,

  -- A personal best they know off the top of their head, as distance + time rather than as
  -- a pace: "10 ק״מ 48:30" is what somebody says, and a pace is derived from it. Both or
  -- neither — half the pair is not a data point, and the reader drops an incomplete one.
  pr_distance_m INTEGER,
  pr_time_sec INTEGER,

  -- The coach's own read: 'yes' | 'maybe' | 'no'. This is an IMPRESSION and the reason the
  -- whole table is service-role only: it is written about a person who has not joined yet
  -- and must never be readable by them.
  fit TEXT,

  -- The staff email that filled it in, because the academy has more than one interviewer and
  -- "who characterised him" is a real question three weeks later.
  recorded_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every read is "this candidate's answers", and the UNIQUE constraint above already indexes
-- `candidate_id` — so there is deliberately no second index here. The only other read is the
-- coach's own "who did I mark as בספק", which at academy scale is a sequential scan of a few
-- dozen rows.

-- Service-role only, like every academy table, and this one more than most: it holds a
-- stranger's injuries and a coach's private verdict on whether they are worth taking. No
-- policies, on purpose — without a policy, anon and authenticated read zero rows, and the
-- anon key ships inside the browser bundle.
ALTER TABLE academy_characterizations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE academy_characterizations IS
  'Answers from the academy characterization call (funnel step 3, migration 110): one row per candidate, upserted while the call is happening. Typed columns rather than a blob because these are INPUTS to the first training plan — available_days, target_race_date and limitations are read by the plan composer. Holds injuries and the coach''s private fit verdict, so service-role only. See migration 111.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect one row, rowsecurity = true, and no policies.
--
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'academy_characterizations';
--   SELECT count(*) AS policies FROM pg_policies WHERE tablename = 'academy_characterizations';
--
-- ROLLBACK (destructive):
--   DROP TABLE IF EXISTS academy_characterizations;
-- ───────────────────────────────────────────────────────────────────────────
