-- 114 — when the trainee was actually told, and what they were told.
--
-- Migration 113 records the coach's decision: the thresholds, the band, the written summary.
-- It says nothing about DELIVERY, and those are two different facts. An approved analysis
-- whose summary is still sitting on the coach's screen is, from the trainee's side, exactly
-- the WhatsApp silence this whole funnel exists to end — and the screen cannot tell the coach
-- "he has not heard this yet" from a column that does not exist.
--
-- ── WHY SENDING IS NOT PART OF APPROVING ──────────────────────────────────────────────
--
-- Approving is a decision about the numbers; sending is a message to a person. They fail
-- differently: a Stream outage must not turn a signed analysis into an unsigned one, and a
-- coach approving eight analyses in a row must not discover afterwards that he also sent
-- eight messages. So `sent_at` is written by its own request, and its absence is a real,
-- readable state rather than an error.
--
-- ── WHY `sent_summary` AND NOT JUST A TIMESTAMP ───────────────────────────────────────
--
-- Because the coach can edit the summary after sending it. With only a timestamp, the screen
-- would show "sent" above text the trainee has never read, and the coach would have no way to
-- know the two had diverged — the same class of error as a stale threshold: a number on a
-- screen that no longer matches the thing it describes. Storing what was actually delivered
-- lets the screen say "the trainee has an earlier version" and offer to resend.
--
-- The thread message itself needs no column: its id is derived from the test id
-- (`academyTestSummaryMessageId`), so a resend EDITS the message already in the thread rather
-- than posting the trainee a second copy of one analysis.

ALTER TABLE academy_test_analyses
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  -- The text as the trainee received it. Never rewritten by an edit to `summary`.
  ADD COLUMN IF NOT EXISTS sent_summary TEXT;

-- A draft cannot have been sent. The whole point of a draft is that nothing left the building,
-- and the honest place to enforce that is here rather than in whichever route writes it next.
ALTER TABLE academy_test_analyses
  DROP CONSTRAINT IF EXISTS academy_test_analyses_sent_is_approved;
ALTER TABLE academy_test_analyses
  ADD CONSTRAINT academy_test_analyses_sent_is_approved
  CHECK (sent_at IS NULL OR status = 'approved');

-- Sent-but-empty is not a thing that can have happened: the message IS the text.
ALTER TABLE academy_test_analyses
  DROP CONSTRAINT IF EXISTS academy_test_analyses_sent_has_text;
ALTER TABLE academy_test_analyses
  ADD CONSTRAINT academy_test_analyses_sent_has_text
  CHECK (sent_at IS NULL OR (sent_summary IS NOT NULL AND btrim(sent_summary) <> ''));

-- "Who has been told" is a queue the coach reads, in the same shape as 113's draft index:
-- approved analyses nobody has delivered yet, oldest first.
CREATE INDEX IF NOT EXISTS idx_academy_test_analyses_undelivered
  ON academy_test_analyses (approved_at)
  WHERE status = 'approved' AND sent_at IS NULL;
