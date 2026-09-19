-- The academy's intake funnel: who is on the way in, and which step they are stuck on.
--
-- Today this lives in Ofer's memory and in WhatsApp history. The question the board has to
-- answer in one second is "who is stuck, and with whom" — nine steps, four different people
-- responsible, and the drop-off is concentrated in the two waits nobody can see (the
-- characterization call that was never scheduled, and the test that was never run).
--
-- ── WHY NOT `signup_requests` (migration 083) ────────────────────────────────────────────
--
-- That table is the CLUB's public door: email + chosen group + pending/approved/rejected,
-- and three routes read that CHECK constraint as exactly those three values. An academy
-- candidate is a different animal:
--
--   * They arrive from an Instagram DM, not from /register — which says in its own copy that
--     academy registration opens later. There is often no email at all for the first few days.
--   * They pass through NINE steps with four owners, not one approval.
--   * The row has to SURVIVE joining. The card the coach opens mid-funnel becomes the
--     trainee's card afterwards — "no step disappears, no starting over" — so `athlete_id` is
--     filled at signup and the history stays attached to the person.
--
-- Widening `signup_requests` to carry all that would put academy candidates into the club's
-- approval queue, where a stranger mid-characterization would read as a member waiting to be
-- let in.
--
-- ── WHY THE STAGE IS NOT A COLUMN ────────────────────────────────────────────────────────
--
-- `academy_candidate_events` is the only record of progress, and the current stage is DERIVED
-- from it (`lib/academy/funnel.ts`): the stage a candidate sits in is the first one with no
-- completed event — i.e. what they are *waiting for*, which is what the board's columns say
-- ("ממתין לשיחת אפיון"). A denormalised `stage` column would have to be written in the same
-- breath as every event forever, and the day the two disagree the board quietly shows the
-- wrong column for a real person. Deriving it also gives "how long have they been waiting"
-- for free: the previous stage's `occurred_at`.
--
-- The cost, recorded so it is not rediscovered: the board cannot be a single indexed query
-- ordered by stage. It reads both tables and computes. At academy scale (a dozen live
-- candidates, nine events each) that is a hundred rows, and correctness is worth more here
-- than a query plan.

CREATE TABLE IF NOT EXISTS academy_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- What they are called, which on day one is whatever the Instagram handle said.
  -- NOT NULL because a row nobody can name is not a candidate, it is a note.
  name TEXT NOT NULL,

  -- Both nullable, and that is the normal state of a brand-new row: the intake is a DM.
  -- The email arrives with the registration form, the phone with the intro call. Neither
  -- is an identity here — `athlete_id` is, once there is one.
  email TEXT,
  phone TEXT,

  -- Where they came from, so the club can see which door works. Free text rather than a
  -- CHECK: 'instagram' and 'form' are today's two, and the next one will be a QR code at a
  -- race, which is not worth a migration.
  source TEXT NOT NULL DEFAULT 'instagram',

  -- The goal in the trainee's own words ("חצי מרתון", "10 ק״מ"), as the form asks it. Shown
  -- on the board because it is half of what tells the coach who this person is.
  goal TEXT,

  -- Set when they become a member. From that moment the same row is the trainee's history,
  -- which is the entire reason this is not two tables. ON DELETE SET NULL so removing an
  -- athlete does not erase how they arrived.
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,

  -- Leaving the funnel WITHOUT joining. Archived rather than deleted: "he said no in
  -- September" is the answer to why he is not on the board, and a deleted row answers
  -- nothing. The reason is free text because the useful ones are sentences, not categories.
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The board's own read: everybody still in the funnel, oldest first.
--
-- `athlete_id IS NULL` is deliberately NOT part of this. Signing up to the platform is step 4
-- of nine — the athlete row exists while the test, the analysis, the first plan and the
-- standing order are all still ahead — so filtering on it would drop candidates off the board
-- exactly where the drop-off actually happens. A candidate leaves the funnel when the LAST
-- stage completes, which only `academy_candidate_events` knows.
CREATE INDEX IF NOT EXISTS idx_academy_candidates_live
  ON academy_candidates (created_at) WHERE archived_at IS NULL;

-- One candidate per athlete, so joining twice cannot fork somebody's history. Partial,
-- because NULL is the common value and several NULLs must be allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_candidates_athlete
  ON academy_candidates (athlete_id) WHERE athlete_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- The steps, as they happened. Append-only in practice: a step that was recorded and then
-- un-recorded is a correction, and corrections are rare enough to be a DELETE by hand.
CREATE TABLE IF NOT EXISTS academy_candidate_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES academy_candidates(id) ON DELETE CASCADE,

  -- One of the nine stage keys in `lib/academy/funnel.ts`. NOT a CHECK constraint: the order
  -- and the labels are product, they live in that module with the tests, and a constraint
  -- here would mean a migration every time the club renames a step. An unknown key is
  -- ignored by the reader rather than trusted.
  stage TEXT NOT NULL,

  -- When the step actually happened, which is NOT when it was typed in: a phone call gets
  -- logged that evening, and "3 days in stage" must count from the call.
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The staff email that recorded it. The card shows WHO did each step, and four people are
  -- responsible for different ones — "Yossi spoke to him" is the fact, not "it was done".
  recorded_by TEXT,

  -- The one free-text field in the whole funnel: what came out of the call. The
  -- characterization ANSWERS are structured elsewhere; this is the sentence a human wants
  -- to read three weeks later ("very keen, been running alone for two years").
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every read is "all events for this candidate" or "all events for these candidates".
CREATE INDEX IF NOT EXISTS idx_academy_candidate_events_candidate
  ON academy_candidate_events (candidate_id, occurred_at);

-- A step recorded twice is one step. The board takes the EARLIEST event for a stage as the
-- moment it completed, so a duplicate would not change a verdict — but it would print the
-- step twice on the card, and the card is a history somebody reads.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_candidate_events_once
  ON academy_candidate_events (candidate_id, stage);

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Service-role only, like every other academy table. This one holds strangers' names,
-- emails and phone numbers plus a coach's private impressions of them, so the anon key —
-- which ships in the browser bundle — must see nothing. No policies, on purpose: without a
-- policy, anon and authenticated read zero rows.
ALTER TABLE academy_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_candidate_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE academy_candidates IS
  'Academy intake funnel: one row per candidate from first contact until they become an athlete (athlete_id) or leave (archived_at). The row survives joining and becomes the trainee''s history. Current stage is DERIVED from academy_candidate_events, never stored. See migration 110.';
COMMENT ON TABLE academy_candidate_events IS
  'One completed intake step: which stage, when it actually happened, who recorded it, and the sentence that came out of it. The only record of funnel progress. See migration 110.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect two rows with rowsecurity = true, and five indexes.
--
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('academy_candidates', 'academy_candidate_events');
--   SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('academy_candidates', 'academy_candidate_events') ORDER BY 1;
--
-- ROLLBACK (destructive):
--   DROP TABLE IF EXISTS academy_candidate_events;
--   DROP TABLE IF EXISTS academy_candidates;
-- ───────────────────────────────────────────────────────────────────────────
