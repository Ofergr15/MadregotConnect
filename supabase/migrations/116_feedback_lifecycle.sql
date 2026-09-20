-- 116 — a report's life after "new": who diagnosed it, what fixed it, whether
-- the person who reported it agrees it is fixed, and one issue per thing rather
-- than one row per complaint.
--
-- WHY: everything the panel needed to answer "what happened to my report" was
-- being carried by `admin_notes` — a single overwritten TEXT line with no
-- author, no timestamp and no history. That is why six bugs fixed in 2.40.35
-- still read as untouched on the board, and why the same bug reported by four
-- people was four rows to triage four times.
--
-- Each group of columns is one question the panel could not answer:
--
--   fixed_in_version / fix_branch / fix_commit
--     "Which release fixed this?" The reporter's push can then name a version to
--     reload into, which a PWA sitting on a stale service worker genuinely needs
--     — otherwise they reopen the app, still see the bug, and conclude nobody
--     listened.
--
--   triaged_by / triaged_at / triage_note
--     "Who decided this, and when?" `triaged_by` is a free-text actor ('cron', a
--     staff email) rather than a FK, because the thing doing the triage is not
--     always a row in `athletes` — and a constraint that forbids recording the
--     truth is worse than no constraint.
--
--   duplicate_of
--     "Is this the same thing as that?" Self-referencing, nullable, ON DELETE SET
--     NULL: losing the primary must orphan the copies, never cascade-delete the
--     reports of four people.
--
--   verified_at
--     "Does the reporter agree?" `status = 'done'` is staff's opinion. This is
--     theirs, and it is the only one that closes the loop.
--
--   archived_at
--     Closing a report currently DELETEs the row, which destroys the reason and
--     the commit — the opposite of what a searchable archive needs. Archiving is
--     a timestamp; nothing is thrown away.
--
-- Purely additive, and every reader degrades when it is missing (see
-- lib/feedback/lifecycle.ts), so the app keeps working until this is applied.
--
-- Run in the Supabase SQL editor, as one block.

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS fixed_in_version text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS fix_branch text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS fix_commit text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS triaged_by text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS triaged_at timestamptz;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS triage_note text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS duplicate_of uuid;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_duplicate_of_fkey;
ALTER TABLE feedback ADD CONSTRAINT feedback_duplicate_of_fkey
  FOREIGN KEY (duplicate_of) REFERENCES feedback(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS feedback_duplicate_of_idx ON feedback(duplicate_of)
  WHERE duplicate_of IS NOT NULL;

COMMENT ON COLUMN feedback.fixed_in_version IS
  'APP_VERSION of the release that fixed this report. Names the version the reporter is asked to reload into.';
COMMENT ON COLUMN feedback.triaged_by IS
  'Free-text actor that diagnosed this: ''cron'' for the overnight pass, or a staff email.';
COMMENT ON COLUMN feedback.duplicate_of IS
  'This report is another report of the id it points at. The panel shows one issue with N reporters.';
COMMENT ON COLUMN feedback.verified_at IS
  'When the REPORTER confirmed it is fixed. status=''done'' is staff''s opinion; this one is theirs.';
COMMENT ON COLUMN feedback.archived_at IS
  'Closed and filed. Replaces DELETE, which destroyed the reason and the commit along with the row.';
