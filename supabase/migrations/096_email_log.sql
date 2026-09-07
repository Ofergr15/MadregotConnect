-- 096_email_log.sql — a durable record of every email this app tries to send.
--
-- WHY THIS EXISTS
-- On 2026-09-06 an approval mailed nobody and reported success. Two independent
-- failures had to line up for that, and the second one is what this table is for:
--
--   1. resend.emails.send() does not throw on an API failure — it RESOLVES with
--      { data: null, error }. The route only watched for an exception, so a refusal
--      was indistinguishable from a delivered message. (Fixed in code.)
--   2. Nothing anywhere recorded the attempt. Even once the code told the truth, the
--      truth lived in one HTTP response and then vanished. "Did that person ever get
--      their link?" was unanswerable an hour later, and the link itself was only
--      recoverable from the SQL editor.
--
-- So: one row per attempt, written on the way out, and updated later by Resend's
-- webhook when it learns the message bounced. `status` therefore has two phases —
-- what OUR call did, and what the PROVIDER later observed:
--
--   skipped    no API key in this environment; nothing was attempted
--   refused    Resend rejected the request (see error_code / error_message)
--   failed     the call threw — network, timeout, a bug on our side
--   sent       Resend accepted it. NOT the same as delivered.
--   delivered  the receiving server accepted it   ─┐
--   bounced    it was rejected downstream          ├─ only ever set by the webhook
--   complained the recipient marked it as spam    ─┘
--   delayed    Resend is still retrying
--
-- ⚠️ SECURITY: every row holds an email address, and for the approval mail the
-- recipients are people who applied to the club and may have been turned down. RLS is
-- enabled with NO policies, exactly like signup_requests — service-role routes read
-- it, a logged-in member never can.

CREATE TABLE IF NOT EXISTS email_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Which mail this is, as a stable key rather than the subject line: subjects are
  -- Hebrew prose and get reworded, and this is what gets grouped and counted.
  template        text NOT NULL,
  -- An array because some of these go to the whole approver list in one call. Worth
  -- knowing: with an unverified sender Resend refuses the WHOLE send if any one
  -- recipient is not allowed, so a multi-recipient row fails as a unit.
  recipients      text[] NOT NULL,
  subject         text NOT NULL,
  from_address    text NOT NULL,

  status          text NOT NULL DEFAULT 'sent',
  -- Resend's id for the message. The join key for the webhook, and the thing to
  -- paste into their dashboard when a delivery is disputed.
  provider_id     text,
  error_code      text,
  error_message   text,

  -- Optional back-references, so "what did we send this person" is one query rather
  -- than a string match on an address. Deliberately NOT foreign keys: this is an
  -- audit trail and it must outlive the row it talks about (a rejected applicant
  -- never gets an athlete row at all).
  athlete_id      uuid,
  signup_request_id uuid,

  CONSTRAINT email_log_status_check CHECK (status IN (
    'skipped', 'refused', 'failed', 'sent', 'delivered', 'bounced', 'complained', 'delayed'
  ))
);

-- The newest-first read the health screen does.
CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC);
-- "what is broken right now" — the only query that matters when 30 links go out.
CREATE INDEX IF NOT EXISTS email_log_status_idx ON email_log (status, created_at DESC);
-- The webhook's lookup. Not UNIQUE: a NULL provider_id is normal (skipped/refused
-- rows never got one) and Postgres would allow duplicate NULLs anyway, but a resend
-- of the same message is a new row with a new id, so uniqueness buys nothing.
CREATE INDEX IF NOT EXISTS email_log_provider_idx ON email_log (provider_id)
  WHERE provider_id IS NOT NULL;
-- "did dana@ ever get anything from us"
CREATE INDEX IF NOT EXISTS email_log_recipients_idx ON email_log USING GIN (recipients);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE email_log IS
  'One row per outbound email attempt. status distinguishes what our call did (skipped/refused/failed/sent) from what Resend later observed (delivered/bounced/complained/delayed). RLS on, no policies: service-role reads only.';
