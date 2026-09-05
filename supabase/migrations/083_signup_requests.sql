-- Public club sign-up requests, and the approval queue over them.
--
-- WHY A SEPARATE TABLE, and not another unapproved `athletes` row (which is what
-- /api/athletes/connect and /api/academy/register both do today): a request from
-- the shareable form is not a member yet, and most of what an athlete row means
-- has no answer at that point — no name, no coach, no watch, no role. Ofer chose
-- this shape deliberately, so that a stranger filling in a form can never appear
-- in the member list, the leaderboards, the feed, a group's roster, or any count
-- of the club, no matter which query forgets to filter on `approved`. Approval is
-- the moment an athlete row is created, and it is the only such moment.
--
-- The cost of the choice, recorded here so it is not rediscovered: approval has
-- its own route (/api/admin/registrations/approve) rather than reusing
-- /api/admin/approve, because there is no athlete row to flip yet. The two must
-- stay in step on what "approved" implies.
--
-- The form asks for exactly three things, and the third is not a question:
--   1. email          — the identity, and where the approval link goes
--   2. group          — which pace group they think they belong to (optional;
--                       the coach can change it before approving)
--   3. created_at     — when they registered, stamped by the database

CREATE TABLE IF NOT EXISTS signup_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Stored already-normalised (lower/trim) by the API; the unique index below
  -- does NOT lower() it, so writing a raw address here would let a second
  -- request in under a different case.
  email TEXT NOT NULL,

  -- Nullable on purpose: same as `athletes.group_id` at sign-up. Someone new to
  -- the club often does not know which דבוקה they belong in, and being unsure
  -- must not be a reason they cannot register. ON DELETE SET NULL so retiring a
  -- group never deletes a pending request.
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  approved_at TIMESTAMPTZ,
  approved_by TEXT,                         -- the approver's verified session email
  rejected_at TIMESTAMPTZ,
  rejected_by TEXT,

  -- Filled at approval: the athlete row that was created, and the token that the
  -- approval email's "continue" link carries into /join/{token}. Kept here as
  -- well as on the athlete row so the queue can show, and re-send, the exact
  -- link that was mailed.
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  invite_token TEXT,

  -- Free-text provenance, so a request from a future second form (a QR code at a
  -- race, say) is distinguishable from the shared link's.
  source TEXT NOT NULL DEFAULT 'public-form'
);

ALTER TABLE signup_requests
  ADD CONSTRAINT signup_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- ONE pending request per address. Partial, so that a rejected applicant can
-- re-apply later and an approved one can come back after leaving the club —
-- neither of which a plain UNIQUE(email) would allow. A repeat submission while
-- still pending is an idempotent no-op in the API, not an error to the person
-- filling in the form (they have no way of knowing they already applied).
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_requests_pending_email
  ON signup_requests (email) WHERE status = 'pending';

-- The queue's own query: pending, oldest first.
CREATE INDEX IF NOT EXISTS idx_signup_requests_status_created
  ON signup_requests (status, created_at);

-- Every read and write goes through the service-role client in
-- src/lib/supabase/server.ts, which bypasses RLS. Enabled anyway so that the
-- anon key — which ships in the browser bundle — cannot read the table if a
-- policy is ever added by hand. Deliberately NO policies: without one, anon and
-- authenticated see nothing at all. This list is a list of strangers' email
-- addresses; it must not be readable by a logged-in member.
ALTER TABLE signup_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE signup_requests IS
  'Public sign-up requests from the shareable /register form: email, chosen group, and when. Becomes an athletes row only on approval, which also mails a /join/{token} link to finish registering. See migration 083.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect one row, rowsecurity = true, and the two indexes.
--
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'signup_requests';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'signup_requests';
--
-- ROLLBACK (destructive — drops any pending requests with it):
--   DROP TABLE IF EXISTS signup_requests;
-- ───────────────────────────────────────────────────────────────────────────
