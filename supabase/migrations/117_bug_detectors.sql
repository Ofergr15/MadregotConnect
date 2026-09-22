-- 117 — the automatic detectors: findings land in the SAME reports queue as the
-- human reports, with their evidence attached and a per-detector false-positive
-- counter that is visible rather than quietly calibrated.
--
-- WHY, and why it is these columns:
--
--   ONE QUEUE. There is no second board. A finding is a row in `feedback` like
--   any other report, which is what lets a finding and the three people who
--   reported the same thing collapse into one issue with four reporters (116's
--   `duplicate_of` does that part). A separate `findings` table would have meant
--   two boards, and the predictable failure of two boards is that only the one
--   with people in it gets read.
--
--   source / detector
--     Which detector proposed this, and whether a human or a query wrote it.
--     NULL source means human, so every existing row is already correct.
--
--   evidence JSONB
--     How it was found, in words, plus the countable specifics and the athletes
--     it touches. A detector that shows a conclusion without showing how it got
--     there is a black box nobody can disagree with, and disagreeing with it is
--     the single most important action the board has to support.
--
--   affected_count
--     PEOPLE, not events. The board ranks by this, because 400 errors from one
--     athlete with an ancient phone matter less than one error hitting seven.
--
--   signal_strength
--     'finding' or 'weak'. A finding that cannot name the people it affected is
--     a weak signal: its own drawer, no alert. That one distinction is the
--     difference between a board that gets opened in the morning and a board
--     that gets abandoned in week two.
--
--   first_seen_version
--     Which release started it. Turns an hour of bisecting into one line.
--
--   finding_key + its unique index
--     The same underlying fact must UPDATE last night's row rather than open a
--     second copy of it every night. The key is built from the ids involved and
--     deliberately excludes anything that moves with the run (a day count, a
--     date), so a run on Tuesday recognises Monday's finding.
--
--   bug_detectors
--     One row per detector, holding its mute state and its false-positive count.
--     A detector that was wrong three times out of four is muted IN THE OPEN,
--     with the date and the reason — not silently tuned. The reason is that the
--     damage a noisy detector does is not the alerts, it is that you stop
--     believing the accurate ones too.
--
-- Purely additive. Every reader degrades when these are missing, so the app
-- keeps working until this is applied.
--
-- Run in the Supabase SQL editor, as one block.

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS detector text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS evidence jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS affected_count integer;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS signal_strength text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS first_seen_version text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS finding_key text;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_finding_key_idx ON feedback(finding_key)
  WHERE finding_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS bug_detectors (
  key text PRIMARY KEY,
  last_run_at timestamptz,
  last_found_count integer NOT NULL DEFAULT 0,
  finding_count integer NOT NULL DEFAULT 0,
  false_positive_count integer NOT NULL DEFAULT 0,
  muted_at timestamptz,
  mute_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN feedback.source IS
  'Who filed this: NULL or human for a person, detector for an automatic finding.';
COMMENT ON COLUMN feedback.evidence IS
  'How the detector found this, the countable specifics, and the athletes it touches. Shown so the finding can be argued with.';
COMMENT ON COLUMN feedback.affected_count IS
  'How many PEOPLE this affected. The board ranks by this, not by how many times it happened.';
COMMENT ON COLUMN feedback.signal_strength IS
  'finding, or weak when it cannot name the people affected. A weak signal never alerts.';
COMMENT ON COLUMN feedback.finding_key IS
  'Stable identity of the underlying fact, so a nightly run updates its own finding instead of duplicating it.';
COMMENT ON TABLE bug_detectors IS
  'Per-detector state: when it last ran, what it found, and how often it was wrong. A detector that is muted is muted in the open.';
