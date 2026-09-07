-- 098 · "זה אני" — a member proving that a Strava sign-in belongs to their account
--
-- The last gap in the duplicate story. A Strava login now recognises a roster row
-- across scripts and merges itself into it (see 097 and the OAuth callback), and an
-- approver can confirm a near match from the registrations queue. Neither reaches
-- the member whose name simply cannot be read with certainty: "Roey Roth" against
-- "רועי רוט" is three consonants, which is not evidence of anybody, and guessing on
-- it would eventually hand one member another member's account.
--
-- That person can still prove who they are without anybody's help, because they
-- control the mailbox their roster row is keyed on. They type the address they
-- joined with, we mail that address a link, and clicking it merges the sign-in into
-- their real account. The email IS the proof — nothing here trusts what was typed.
--
-- WHY A TABLE AND NOT A SIGNED TOKEN. The claim must be single-use and revocable
-- after the fact, and it must leave a trail: this is the one path where a merge is
-- authorised by somebody who is not signed in as either row. `claimed_at` in a
-- WHERE clause is what makes it single-use under a race (the same trick
-- login_handoffs uses in 082), and a JWT cannot be un-issued.

CREATE TABLE IF NOT EXISTS athlete_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The token as it travels in the link. Random 32 bytes, hex — long enough that
  -- guessing one is not a strategy, and unique so a collision is a failed insert
  -- rather than two people sharing a claim.
  token text NOT NULL UNIQUE,
  -- The Strava sign-in doing the asking: always a synthetic-email shell row.
  shell_athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- The account being claimed, resolved server-side from the typed address. Stored
  -- rather than re-resolved on confirm: the answer must be the one that was mailed,
  -- even if the roster changes in the ten minutes in between.
  target_athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- Where the link was sent. Kept for the audit trail — "who authorised this
  -- merge" has no other answer.
  sent_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Short on purpose. A link that merges accounts should not be sitting in an inbox
  -- a month later; asking again costs one form.
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  claimed_at timestamptz
);

-- The lookup on confirm is by token alone.
CREATE INDEX IF NOT EXISTS idx_athlete_claims_token ON athlete_claims (token);
-- "has this shell already asked?" — for the rate limit in the start route.
CREATE INDEX IF NOT EXISTS idx_athlete_claims_shell ON athlete_claims (shell_athlete_id, created_at DESC);

-- No policies, deliberately: every read and write goes through the service role in
-- /api/auth/claim-member. RLS on with nothing granted means a leaked anon key
-- cannot enumerate live claim tokens, which are as good as a session for the one
-- account each names.
ALTER TABLE athlete_claims ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE athlete_claims IS
  'Single-use email-verified claims: a Strava sign-in proving it belongs to an existing member. Consumed by /api/auth/claim-member/confirm, which calls merge_athlete_rows (097).';

-- Verify:
--   SELECT count(*) FROM athlete_claims;
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'athlete_claims';
--
-- Rollback:
--   DROP TABLE IF EXISTS athlete_claims;
