-- 356_strava_webhook_events.sql — durable Strava webhook idempotency (task 192). FILE ONLY, not applied.
-- Paste by hand. Idempotent.
--
-- One row per Strava event (activity id : aspect : event_time). The webhook INSERTs
-- the key before syncing; a unique violation means another instance (or a retry
-- after a cold start) already took it, so the second one skips. The in-memory set
-- in lib/strava/webhook-dedupe stays as the first, free check. Until this is
-- applied the route falls back to that set alone (today's behaviour).
-- Rows older than 7 days are deleted by the webhook itself after each event.

CREATE TABLE IF NOT EXISTS public.strava_webhook_events (
  event_key   text        PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strava_webhook_events_received_at_idx
  ON public.strava_webhook_events (received_at);

-- Server (service role) only.
ALTER TABLE public.strava_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.strava_webhook_events FROM anon, authenticated;
