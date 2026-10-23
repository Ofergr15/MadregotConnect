-- 169: partner orders — purchases made with the club's codes, read from the club's mailbox
-- (lib/partner-orders, mockup ~/.cache/madregot/coupons/mockup.html, Ofer 10-23).
-- One row per order email. `commission` is kept but never shown or exported (Ofer: sensitive).
-- Service role only (no policies). Paste as one block; safe to run twice.
CREATE TABLE IF NOT EXISTS partner_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner      TEXT NOT NULL,           -- 'HOKA'
  via          TEXT,                    -- the store, 'WeShoes'
  source       TEXT NOT NULL,           -- 'goaffpro'
  order_number TEXT,
  amount       NUMERIC(10,2) NOT NULL,
  commission   NUMERIC(10,2),
  ordered_at   TIMESTAMPTZ NOT NULL,    -- the email's date
  message_id   TEXT NOT NULL UNIQUE,    -- the email's Message-ID, so a re-read never doubles
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_orders_ordered_at ON partner_orders (ordered_at DESC);
ALTER TABLE partner_orders ENABLE ROW LEVEL SECURITY;
