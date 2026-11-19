-- 178: one "form received" mail set per card per window, even for two submits in the same instant.
-- NOT APPLIED. Proposal for review; paste by hand in the Supabase SQL editor once approved.
--
-- /api/academy/register checks email_log for a recent academy_form_received row, but two
-- requests arriving together both pass that read. The route now claims the send with
--   UPDATE academy_candidates SET form_mail_claimed_at = now()
--    WHERE id = $1 AND (form_mail_claimed_at IS NULL OR form_mail_claimed_at < now() - 10 min)
--   RETURNING id;
-- and mails only when a row comes back. No existing column can carry this: updated_at is
-- bumped by every form submit and staff edit (a version, not a claim), and intake is jsonb
-- (no compare-and-set through PostgREST). Until this is applied the route falls back to the
-- email_log check (PGRST204 / 42703 tolerated).
ALTER TABLE academy_candidates ADD COLUMN IF NOT EXISTS form_mail_claimed_at timestamptz;

COMMENT ON COLUMN academy_candidates.form_mail_claimed_at IS
  'When /api/academy/register last claimed the "form received" mails + staff push for this card. Conditional UPDATE: only one concurrent submit wins. See migration 178.';
