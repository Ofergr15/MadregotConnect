-- A trainee may submit their own test, and nothing moves until the coach approves it.
--
-- Until now `academy_tests` was staff-write-only, for a reason worth restating: the
-- threshold this table produces is what every workout in that athlete's plan is priced
-- against. A self-reported number that is 300m generous does not just draw one optimistic
-- point on one graph — it makes every interval in the next block a little too fast, and the
-- athlete then fails workouts that were never meant to be that hard. So "the runner types
-- it" cannot mean "the runner sets their own paces".
--
-- The club already solved this shape once, on `benchmark_results`: an athlete may submit,
-- and anything that would enter the top three waits in a `status='pending'` queue for
-- staff. Same vocabulary here — `status`, `submitted_by`, `submitted_at` — so there is one
-- approval idea in the schema and not two. The difference is what pending MEANS: on the
-- records board a pending result is merely absent from a public ranking, while a pending
-- test must be absent from the threshold, the trend, and the staleness clock. The API
-- filters it out of all three, which is why it can afford to stay in this table rather
-- than in a staging one.
--
-- DEFAULT 'approved' is deliberate and load-bearing. Every row that exists when this runs
-- was entered by staff, and a default of 'pending' would silently un-approve the club's
-- whole history the moment the API started filtering — the graph would empty out and the
-- registry would report everyone as never tested. Coach entry stays approved on arrival:
-- asking Ofer to approve his own typing is a queue that only ever wastes his time.

ALTER TABLE academy_tests
  -- 'approved' counts toward the threshold, the trend, and the staleness clock.
  -- 'pending'  is a submission waiting for staff, and counts toward nothing.
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'pending')),

  -- The athlete who submitted it, when it came from the runner rather than the coach.
  -- NULL means staff entry. Kept separate from `author_id`, which answers a different
  -- question — author is whoever typed the row, and after an approval-with-correction
  -- those are two different people.
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,

  -- Who let this number start pricing someone's plan, and when. `benchmark_results` does
  -- not record this and does not need to: approving a club record changes a list. Approving
  -- a test changes the training of a person, so the decision gets a name against it.
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- The coach's queue: "is anything waiting for me", asked on every load of the tests tab.
-- Partial, because pending is the rare state by design — an index over the whole table
-- would be mostly approved rows nobody is querying for.
CREATE INDEX IF NOT EXISTS idx_academy_tests_pending
  ON academy_tests(status, submitted_at DESC)
  WHERE status = 'pending';

COMMENT ON COLUMN academy_tests.status IS
  'approved = counts toward the threshold, trend and staleness clock. pending = an athlete '
  'submission awaiting staff; excluded from all three. Coach entries arrive approved.';

-- ── Verification ─────────────────────────────────────────────────────────────
-- Expect: five new columns present, every existing row approved, nothing pending.
SELECT
  count(*)                                             AS total_rows,
  count(*) FILTER (WHERE status = 'approved')          AS approved,
  count(*) FILTER (WHERE status = 'pending')           AS pending,
  count(*) FILTER (WHERE submitted_by IS NOT NULL)     AS self_submitted,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'academy_tests'
      AND column_name IN ('status', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at')
  )                                                    AS new_columns
FROM academy_tests;
