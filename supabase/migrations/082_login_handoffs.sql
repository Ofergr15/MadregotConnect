-- ═══════════════════════════════════════════════════════════════════════════
-- 082 — login_handoffs: give a PWA back the login it started
--
-- SCHEMA. Safe to run at any time, in any order relative to 054/079/080/081.
-- Nothing reads this table until the code that writes it is deployed, and the
-- code degrades to the old behaviour while the table is missing — so applying
-- this before or after the deploy both work.
--
-- WHY IT EXISTS
--
-- A standalone iOS web app may not navigate off its own origin. Tapping "log in
-- with Strava" therefore opens iOS's in-app browser sheet — the one with the ✕
-- and the Safari compass — and that sheet has its own storage partition. The
-- session the OAuth callback establishes inside it is invisible to the app
-- underneath, so the member logs in, closes the sheet, and is still looking at
-- the marketing page. Every launch. (This started the moment the app became a
-- real PWA: before that the icon opened a Safari tab, which shared storage.)
--
-- The sheet and the app share nothing except our server. So the callback parks
-- the finished login here and the app claims it when it returns to the
-- foreground.
--
-- WHY A PUBLIC CHALLENGE IS SAFE TO STORE IN THE CLEAR
--
-- `challenge` is base64url(SHA-256(verifier)) — PKCE S256. The verifier is 32
-- random bytes generated inside the app, kept in its localStorage, and never
-- transmitted until the claim. The challenge travels in the OAuth `state`, so it
-- passes through Strava and lands in request logs; knowing it is useless without
-- the verifier. Claiming is a single atomic UPDATE .. WHERE claimed_at IS NULL,
-- so a row can only ever be spent once, and expires_at caps the window at ten
-- minutes.
--
-- `auth_email` is the synthetic strava_<id>@strava.madregot.local address the
-- login authenticates as, not the member's own address. It is the account the
-- claim mints a session for; resolve-role maps it to the real roster row.
--
-- The table is self-cleaning: every insert first deletes rows that are already
-- expired, which on a club this size keeps it at a handful of rows and means no
-- cron has to remember it exists.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_handoffs (
  challenge   text        PRIMARY KEY,
  auth_email  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  claimed_at  timestamptz
);

-- The sweep at the top of every insert.
CREATE INDEX IF NOT EXISTS idx_login_handoffs_expires_at
  ON login_handoffs (expires_at);

-- Service-role only. Every access goes through /api/strava/callback and
-- /api/auth/claim-login, which hold the service key; RLS with no policy means a
-- leaked anon key cannot read a pending login even if it somehow guessed the
-- challenge.
ALTER TABLE login_handoffs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE login_handoffs IS
  'Short-lived PKCE-style handoff of a completed Strava login from the iOS in-app browser sheet back to the standalone PWA that started it. See migration 082.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect one row describing the table, and rowsecurity = true.
-- ───────────────────────────────────────────────────────────────────────────
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'login_handoffs') AS columns
  FROM pg_class c
 WHERE c.relname = 'login_handoffs';
