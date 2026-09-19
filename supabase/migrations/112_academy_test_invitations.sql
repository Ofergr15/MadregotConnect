-- The test the trainee has NOT run yet.
--
-- ── WHY THIS IS NOT `academy_tests` ──────────────────────────────────────────────────────
--
-- `academy_tests` (migration 105) holds `duration_sec NUMERIC NOT NULL CHECK (> 0)` and
-- `distance_m NUMERIC NOT NULL CHECK (> 0)`. Those constraints are correct and they are the
-- whole reason this table exists: a test that has been SCHEDULED has no duration and no
-- distance, because it has not happened. Storing an appointment there would mean either
-- dropping the NOT NULLs — which is how you get a test whose pace cannot be computed — or
-- writing a placeholder 0, which fails the CHECK, or a placeholder 1, which draws a point on
-- the improvement graph at a pace of sixteen minutes a kilometre.
--
-- The two tables are two different facts: an INTENTION and a MEASUREMENT. They meet exactly
-- once, at `test_id` below, and that meeting is what "done" means.
--
-- ── WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────
--
-- Funnel step 6 — waiting for the test — is where candidates are lost. Not because they
-- decided against it, but because a 30-minute all-out effort is the kind of thing a person
-- genuinely means to do on Thursday and then does not, and nobody asks again. Today the only
-- thing that happens is Ofer remembering. The trainee's screen currently shows an entry form
-- with no date on it, which asks somebody to report a test nobody told them to run.
--
-- So an invitation carries four things a bare date does not:
--
--   1. WHEN, as one proposed slot plus alternatives. Offering alternatives is what converts
--      "does not suit me" from silent attrition into a tap. The coach's Thursday is a guess
--      about a stranger's week.
--   2. HOW, because the protocol is not obvious and running it wrong wastes the test. Going
--      out too hard is the standard failure, and it produces a threshold that is too slow —
--      which then prices every workout in the first block too easy.
--   3. A CONFIRMATION, so "he has not answered" and "he answered and has not run it" are
--      different rows rather than the same silence.
--   4. THE REMINDERS, twice: before, so it is not forgotten, and after, so forgetting is
--      caught. See the reminder columns.
--
-- ── ONE TEST AT A TIME ──────────────────────────────────────────────────────────────────
--
-- The partial unique index below allows an athlete only one OPEN invitation. Two live
-- invitations is not a state worth a screen: the athlete would confirm one and run the
-- other, and the coach would chase a test that was already done. Closed rows (done,
-- cancelled) are kept forever and excluded from the index — "we invited him three times and
-- he never ran it" is the answer to a question somebody will eventually ask.

CREATE TABLE IF NOT EXISTS academy_test_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

  -- Which test was asked for: '30min', '2000m', the club's own label. Same vocabulary as
  -- `academy_tests.protocol`, and it must survive onto the result — an invitation to a
  -- 30-minute test that comes back as a 2000m is a different measurement, not this one.
  protocol TEXT NOT NULL DEFAULT '30min',

  -- ── WHEN ───────────────────────────────────────────────────────────────────────────────
  --
  -- Instants, not a date plus a time string. A test appointment has a clock time (07:00), and
  -- the reminder is "twelve hours before" it — arithmetic that a DATE cannot do and that a
  -- date-plus-text pair gets wrong twice a year when Israel changes its clocks.
  --
  -- `proposed_slots` is an ORDERED array whose first element is the slot the coach is
  -- actually asking for; the rest are the alternatives offered alongside it. One array rather
  -- than a primary column plus an alternatives column, because the athlete tapping the second
  -- chip must produce exactly the same kind of row as accepting the first — a "chose an
  -- alternative" state that reads differently from "accepted" is a distinction with no
  -- consequence that every later query then has to remember.
  proposed_slots TIMESTAMPTZ[] NOT NULL DEFAULT '{}',

  -- Which slot the athlete accepted. NOT constrained to be one of `proposed_slots`: the coach
  -- can set a time agreed on the phone, and a CHECK here would refuse the most common real
  -- correction.
  confirmed_slot TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,

  -- ── STATE ──────────────────────────────────────────────────────────────────────────────
  --
  -- 'proposed'  — sent, no answer yet.
  -- 'confirmed' — the athlete said yes to a time. `confirmed_slot` is then required.
  -- 'other'     — the athlete cannot make any offered slot and has asked for another time.
  --               A distinct state and not a cancellation: it is the most engaged answer a
  --               trainee can give short of yes, and it needs the coach, so collapsing it
  --               into 'cancelled' would hide the one person actively trying to comply.
  -- 'done'      — a result arrived. `test_id` is then set.
  -- 'cancelled' — withdrawn by staff, or superseded.
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'other', 'done', 'cancelled')),

  -- What the athlete said when asking for a different time. Free text on purpose: "I work
  -- shifts until the 20th" is not a value in an enum, and it is the whole content of the
  -- message.
  requested_note TEXT,

  -- The measurement that closed this invitation. ON DELETE SET NULL rather than CASCADE: a
  -- re-synced or deleted activity can take its test row with it, and losing the invitation
  -- too would resurrect a months-old nag for a test that was run.
  test_id UUID REFERENCES academy_tests(id) ON DELETE SET NULL,

  -- ── THE TWO REMINDERS ──────────────────────────────────────────────────────────────────
  --
  -- Rows in `scheduled_notifications` (migration 027) rather than a reminder engine of this
  -- table's own: that scanner already does `audience_type='athlete'`, `schedule_type='once_at'`
  -- and `next_run_at`, and a second thing that sends push at a time is a second thing that
  -- can double-send.
  --
  -- The ids are held here for one specific reason, and it is the point of the whole feature.
  -- The follow-up is conditional — "another reminder IF the test was not done" — and a
  -- scheduled_notifications row fires unconditionally. The condition is therefore expressed
  -- by CANCELLING this row when the result arrives, which needs its id. Getting that wrong
  -- sends "you have not done your test yet" to somebody who did it, which is the single most
  -- trust-destroying message this product can send: it proves the app is not reading what
  -- the person actually did.
  reminder_before_id UUID REFERENCES scheduled_notifications(id) ON DELETE SET NULL,
  reminder_after_id UUID REFERENCES scheduled_notifications(id) ON DELETE SET NULL,

  -- Staff, as an athletes row holding a staff role, as elsewhere in the academy.
  created_by UUID REFERENCES athletes(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A confirmed invitation without a time is unrenderable: the trainee's screen, the
  -- reminder time and the coach's "who is testing this week" all read `confirmed_slot`.
  CONSTRAINT academy_test_invitations_confirmed_has_slot
    CHECK (status <> 'confirmed' OR confirmed_slot IS NOT NULL),

  -- 'done' means a measurement exists. Without this, an invitation can be marked done with
  -- nothing to show, and the improvement graph and the staleness clock disagree with the
  -- funnel about whether the athlete has tested.
  CONSTRAINT academy_test_invitations_done_has_test
    CHECK (status <> 'done' OR test_id IS NOT NULL)
);

-- One open invitation per athlete. See the header: closed rows stay, and stay out of here.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_test_invitations_open
  ON academy_test_invitations (athlete_id)
  WHERE status IN ('proposed', 'confirmed', 'other');

-- The coach's two questions: "who has not answered me" and "who is testing this week".
-- Both are scans over open rows only, which is why the index is partial on the same
-- predicate rather than over the whole history.
CREATE INDEX IF NOT EXISTS idx_academy_test_invitations_due
  ON academy_test_invitations (confirmed_slot)
  WHERE status IN ('proposed', 'confirmed', 'other');

-- Service-role only, like every academy table. No policies on purpose: without a policy
-- anon and authenticated read zero rows, and the anon key ships inside the browser bundle.
ALTER TABLE academy_test_invitations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE academy_test_invitations IS
  'A test that has been scheduled and not yet run — funnel step 6, the step where candidates '
  'are lost. Separate from academy_tests because that table requires a duration and a '
  'distance, which an appointment does not have. Meets it at test_id, which is what done means.';
COMMENT ON COLUMN academy_test_invitations.proposed_slots IS
  'Ordered; the first element is the slot being asked for and the rest are alternatives '
  'offered with it. Offering alternatives turns "does not suit me" from silent attrition '
  'into a tap.';
COMMENT ON COLUMN academy_test_invitations.status IS
  'proposed | confirmed | other | done | cancelled. "other" is the athlete asking for a '
  'different time — the most engaged answer short of yes, so never folded into cancelled.';
COMMENT ON COLUMN academy_test_invitations.reminder_after_id IS
  'The follow-up nag. Conditional on the test NOT having been run, and a scheduled '
  'notification fires unconditionally — so the condition is this row being CANCELLED when '
  'the result arrives. Sending it to somebody who tested is the worst message here.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect 0 rows, rowsecurity = true, no policies, and both CHECKs present.
--
--   SELECT count(*) AS rows FROM academy_test_invitations;
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'academy_test_invitations';
--   SELECT count(*) AS policies FROM pg_policies WHERE tablename = 'academy_test_invitations';
--
-- ROLLBACK (destructive):
--   DROP TABLE IF EXISTS academy_test_invitations;
-- ───────────────────────────────────────────────────────────────────────────
