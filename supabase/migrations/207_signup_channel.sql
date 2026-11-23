-- 207 — which door a sign-up came through (leads deep-dive, 2026-11-23).
--
-- `signup_requests.source` says what KIND of request a row is ('public-form' / 'strava-login' /
-- 'club-backfill'), but the web form and the native app post the same form to the same route, so both
-- land as 'public-form' and nobody can tell them apart. `channel` is the door:
--   web      the /register form (also the default for every caller that sends nothing)
--   app_ios  the native app's gateway
--   invite   a /join/{token} invite link
-- Plain text with a CHECK, no FK and no new table, so no PostgREST embed gains a second path
-- (the "more than one relationship" trap from migration 125 does not apply here).
--
-- Both columns are nullable: old rows stay NULL (= unknown, NOT 'web'), and the routes fall back to
-- inserting without the column when this migration has not been pasted yet (42703 / PGRST204).
-- Paste in the Supabase SQL editor; safe to run twice.

ALTER TABLE signup_requests  ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS channel text;

DO $$ BEGIN
  ALTER TABLE signup_requests ADD CONSTRAINT signup_requests_channel_check
    CHECK (channel IS NULL OR channel IN ('web', 'app_ios', 'invite'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE onboarding_events ADD CONSTRAINT onboarding_events_channel_check
    CHECK (channel IS NULL OR channel IN ('web', 'app_ios', 'invite'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The leads/funnel screens split a cohort by channel.
CREATE INDEX IF NOT EXISTS signup_requests_channel_created_idx ON signup_requests (channel, created_at DESC);
