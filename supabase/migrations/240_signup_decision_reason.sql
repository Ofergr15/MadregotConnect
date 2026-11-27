-- Task 62: a reason on every sign-up rejection, so the admin queue can say WHY
-- a request was turned down, and so an undo restores a clean row.
--
-- Read/written by /api/admin/signup-queue. Until this is pasted the route still
-- works and answers `reasonStored: false`. Idempotent; safe to run twice.
--
-- Numbered 240 (not 225) on purpose: two overnight agents were writing migrations
-- in parallel; 225-239 were left for the other queue. Re-check before applying.

ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS decision_reason TEXT;
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS decision_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signup_requests_decision_reason_check'
  ) THEN
    ALTER TABLE signup_requests
      ADD CONSTRAINT signup_requests_decision_reason_check
      CHECK (decision_reason IS NULL
             OR decision_reason IN ('spam', 'duplicate', 'not_in_club', 'wrong_details', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN signup_requests.decision_reason IS
  'Why the request was rejected (code; Hebrew label in src/lib/signup-decisions). NULL while pending/approved.';
COMMENT ON COLUMN signup_requests.decision_note IS
  'Optional approver note, max 280 chars, never mailed to the applicant.';

-- VERIFY:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'signup_requests' AND column_name LIKE 'decision_%';
-- ROLLBACK:
--   ALTER TABLE signup_requests DROP CONSTRAINT IF EXISTS signup_requests_decision_reason_check;
--   ALTER TABLE signup_requests DROP COLUMN IF EXISTS decision_note, DROP COLUMN IF EXISTS decision_reason;
