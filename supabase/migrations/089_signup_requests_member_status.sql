-- Record the /register submissions that came from people who are ALREADY members.
--
-- THE GAP THIS CLOSES. The public form has three outcomes (see
-- src/app/api/public/signup/route.ts): new, already-pending, and already-a-member.
-- The first two write a row to signup_requests; the third wrote nothing at all —
-- "nothing to queue", which is true of the QUEUE and false of the record. So an
-- existing member who opened the shared link was told, correctly, that their
-- address is already registered, and then vanished: no row, no entry in
-- /dashboard/registrations, no way for the coach to know they had responded to the
-- link at all. Ofer hit this with his own friends on 2026-09-06.
--
-- Fixed by giving those submissions a status of their own rather than folding them
-- into 'approved'. They are NOT approvals: nobody approved anything, no athlete row
-- was created by this, and approved_by/approved_at must stay empty so the audit
-- trail keeps meaning what it says. 'member' means "this address submitted the form
-- and already had an account" — a fact worth keeping, and never an action item.
--
-- ⚠️ Submissions made BEFORE this migration are not recoverable. They were never
-- written down anywhere, so there is nothing to backfill; the record starts here.

-- 1. Allow the new status. The constraint is replaced rather than added to, because
--    a CHECK cannot be extended in place.
ALTER TABLE signup_requests DROP CONSTRAINT IF EXISTS signup_requests_status_check;
ALTER TABLE signup_requests
  ADD CONSTRAINT signup_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'member'));

-- 2. One 'member' row per address, for the same reason there is one pending row per
--    address: a member who opens the link twice is one fact, not two. Partial, so
--    it cannot collide with the pending / approved / rejected history of the same
--    email. The API checks before inserting; this is what makes two simultaneous
--    submissions safe rather than merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_requests_member_email
  ON signup_requests (email) WHERE status = 'member';

COMMENT ON COLUMN signup_requests.status IS
  'pending = waiting for approval · approved = became an athlete · rejected = turned down · member = submitted the public form but already had an account (no action needed, kept as a record that they responded to the link). See migration 089.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect the four statuses in the constraint and the new index.
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'signup_requests_status_check';
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'signup_requests' AND indexname LIKE '%member%';
--   SELECT status, COUNT(*) FROM signup_requests GROUP BY status ORDER BY status;
--
-- ROLLBACK (drops the record of member submissions with it):
--   DELETE FROM signup_requests WHERE status = 'member';
--   DROP INDEX IF EXISTS idx_signup_requests_member_email;
--   ALTER TABLE signup_requests DROP CONSTRAINT signup_requests_status_check;
--   ALTER TABLE signup_requests ADD CONSTRAINT signup_requests_status_check
--     CHECK (status IN ('pending', 'approved', 'rejected'));
-- ───────────────────────────────────────────────────────────────────────────
