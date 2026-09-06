-- Pre-launch: put every existing club member into the approval queue as pending,
-- so the coach can approve them and each one gets the /join onboarding email.
--
-- WHY. The club already exists in `athletes` — those people never went through the
-- public /register form, so they have no signup_requests row and cannot be approved
-- from /dashboard/registrations. Ofer wants the opposite for launch: see everybody
-- who is "inside" sitting in pending, work down the list, and have the app send each
-- of them the onboarding link. This is DATA, not schema — it is written as a
-- migration only so the one-off is recorded and repeatable.
--
-- WHAT APPROVING ONE OF THESE ROWS DOES, since it is not the usual case:
-- /api/admin/registrations/approve tries to INSERT the athlete, hits the unique
-- index on athletes.email (23505), and takes the adopt path instead — it sets
-- approved/approved_at/approved_by, mints a fresh invite_token, sets group_id, and
-- mails the /join/{token} link. It does NOT create a second member and it does NOT
-- touch `status`, so an already-active athlete stays active. That path predates this
-- backfill and is the reason no route change was needed.
--
-- ⚠️ TWO THINGS TO KNOW BEFORE RUNNING IT
--
-- 1. The דבוקה chosen in the queue OVERWRITES the athlete's real group at approval.
--    That is why group_id is copied from the athlete row below rather than left
--    NULL: the queue then shows what they already are, and approving changes
--    nothing. A row whose athlete has no group will show "בחר דבוקה" and block
--    approval until one is picked — that gate is deliberate (see the approve route).
--
-- 2. Synthetic Strava addresses are EXCLUDED. A Strava-only signup gets
--    strava_*@strava.madregot.local, which is not a mailbox: queueing them would
--    produce approvals whose onboarding email goes nowhere, with no bounce to say
--    so. Those athletes need a real address on their row first.

-- ── DRY RUN. Run this FIRST and read the list. Nothing is written. ──────────
--
--   SELECT lower(btrim(a.email)) AS email, a.name, a.status, a.group_id IS NULL AS no_group
--     FROM athletes a
--    WHERE a.email IS NOT NULL
--      AND a.email NOT LIKE '%@strava.madregot.local'
--      AND NOT EXISTS (
--            SELECT 1 FROM signup_requests s
--             WHERE s.email = lower(btrim(a.email))
--               AND s.status IN ('pending', 'approved'))
--    ORDER BY no_group DESC, email;
--
-- `no_group = true` rows are the ones that will block on "בחר דבוקה".

INSERT INTO signup_requests (email, group_id, status, source, athlete_id)
SELECT
  -- Normalised the same way the API normalises, because the pending unique index
  -- does not lower() and a mixed-case address would slip a second row past it.
  lower(btrim(a.email)),
  a.group_id,
  'pending',
  -- Distinguishable from 'public-form' forever: these people did not fill anything
  -- in, they were already members.
  'club-backfill',
  a.id
FROM athletes a
WHERE a.email IS NOT NULL
  AND a.email NOT LIKE '%@strava.madregot.local'
  -- Idempotent, so this can be re-run after new members join. 'rejected' and
  -- 'member' rows are NOT excluded: a rejected applicant who later became a member
  -- should still be queueable, and a 'member' note is a record, not a queue entry.
  AND NOT EXISTS (
    SELECT 1 FROM signup_requests s
     WHERE s.email = lower(btrim(a.email))
       AND s.status IN ('pending', 'approved')
  );

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. The pending count should equal the dry run's row count (plus any
-- pending rows that were already there).
--
--   SELECT status, source, COUNT(*) FROM signup_requests
--    GROUP BY status, source ORDER BY status, source;
--
--   -- The ones that will block approval until a דבוקה is picked:
--   SELECT email FROM signup_requests
--    WHERE status = 'pending' AND group_id IS NULL ORDER BY email;
--
-- ROLLBACK (only the rows this inserted, and only while still pending — an
-- approved one has already mailed somebody and must not be deleted):
--   DELETE FROM signup_requests WHERE source = 'club-backfill' AND status = 'pending';
-- ───────────────────────────────────────────────────────────────────────────
