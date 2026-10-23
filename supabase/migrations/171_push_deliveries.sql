-- 171: push deliveries — did each push actually SHOW on the phone (mockup
-- ~/.cache/madregot/mockups/push-health.html, Ofer 10-23). One row per push per device:
-- written when it is sent (accepted = the push service took it), and stamped shown_at
-- when the phone's service worker reports it displayed it. Service role only (no
-- policies). Paste as one block; safe to run twice.
CREATE TABLE IF NOT EXISTS push_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nid             UUID NOT NULL,             -- the push's own number, the same on every device it went to
  athlete_id      UUID,
  subscription_id UUID,
  kind            TEXT,
  title           TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted        BOOLEAN NOT NULL DEFAULT true, -- false = the push service refused it (status in error)
  error           TEXT,
  shown_at        TIMESTAMPTZ                    -- null until the phone confirms it showed it
);
CREATE INDEX IF NOT EXISTS push_deliveries_sent_at ON push_deliveries (sent_at DESC);
CREATE INDEX IF NOT EXISTS push_deliveries_nid ON push_deliveries (nid);
CREATE INDEX IF NOT EXISTS push_deliveries_athlete ON push_deliveries (athlete_id, sent_at DESC);
ALTER TABLE push_deliveries ENABLE ROW LEVEL SECURITY;
