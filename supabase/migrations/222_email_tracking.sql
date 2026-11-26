-- 222_email_tracking.sql — b25 club email center: campaigns + per-message delivery events.
--
-- NOT applied automatically. Paste into the Supabase SQL editor by hand. Idempotent.
--
-- WHAT IT ADDS
--   email_campaigns  one row per "send" an admin makes from the email center (a newsletter,
--                    a resend to who hasn't opened). Transactional mails have no campaign.
--   email_log.campaign_id   which campaign a message belongs to (nullable; FK to
--                    email_campaigns only — NOT a second FK to athletes, see CLAUDE.md on
--                    embed ambiguity; email_log.athlete_id stays a plain uuid as in 096).
--   email_events     one row per provider webhook event (sent / delivered / opened / clicked /
--                    bounced / complained / delayed), keyed by Resend's email id and joined to
--                    email_log by provider_id. Deduped on the Svix message id, because Resend
--                    retries a webhook until it gets a 2xx.
--
-- ⚠️ OPENS ARE APPROXIMATE. An "opened" event is a tracking pixel load. Apple Mail Privacy
-- Protection pre-fetches every image, so Apple Mail users read as opened whether or not they
-- did; clients that block images read as not opened even when they did. Clicks are reliable.
--
-- ⚠️ SECURITY: rows hold recipient addresses and who opened what. RLS on, NO policies —
-- service-role routes only (the admin-only /api/admin/email-center).

CREATE TABLE IF NOT EXISTS email_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by_email text NOT NULL,
  -- 'newsletter' | 'resend_unopened' — free text so a new kind needs no migration.
  kind             text NOT NULL,
  subject          text NOT NULL,
  -- The exact input the html was built from, so a resend re-renders the same mail.
  input            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- draft → tested (a test reached the admin) → sending → sent
  status           text NOT NULL DEFAULT 'draft',
  tested_at        timestamptz,
  sent_at          timestamptz,
  recipient_count  integer NOT NULL DEFAULT 0,
  -- A resend points at the campaign it follows up.
  parent_id        uuid REFERENCES email_campaigns(id) ON DELETE SET NULL,
  CONSTRAINT email_campaigns_status_check CHECK (status IN ('draft', 'tested', 'sending', 'sent'))
);
CREATE INDEX IF NOT EXISTS email_campaigns_created_idx ON email_campaigns (created_at DESC);
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE email_log ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES email_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS email_log_campaign_idx ON email_log (campaign_id) WHERE campaign_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at  timestamptz NOT NULL DEFAULT now(),
  -- When the provider says it happened (payload created_at), not when we heard.
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  type         text NOT NULL,
  -- Resend's email id — the join to email_log.provider_id.
  provider_id  text NOT NULL,
  -- Svix message id: one webhook delivery. UNIQUE makes a retry a no-op.
  svix_id      text,
  recipient    text,
  -- For 'clicked': the link. For 'bounced': the bounce type/message. Never the body.
  detail       text,
  CONSTRAINT email_events_type_check CHECK (type IN (
    'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'delayed'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS email_events_svix_idx ON email_events (svix_id) WHERE svix_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_events_provider_idx ON email_events (provider_id);
CREATE INDEX IF NOT EXISTS email_events_type_idx ON email_events (type, occurred_at DESC);
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE email_events IS
  'Resend webhook events per message (b25). Opens are approximate: Apple Mail Privacy Protection pre-loads pixels. RLS on, no policies.';
COMMENT ON TABLE email_campaigns IS
  'Admin sends from the email center (b25). RLS on, no policies.';
