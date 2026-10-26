-- 173: הזמנת פודיום — receiving the goods and handing each runner their share (lib/podium/receive, Ofer 10-26).
-- Mockup ~/.cache/madregot/mockups/podium-receive/index.html.
--   podium_received        how many of each product actually arrived from Podium, per round
--   podium_orders.allocation  the admin's hand-set share for that runner (NULL = the automatic one:
--                             first to send is served first)
--   podium_orders.delivered_at  handed to the runner — the moment they're told what they got
-- Service role only (no policies). Paste as one block; safe to run twice. Needs 172.

CREATE TABLE IF NOT EXISTS podium_received (
  round_id   UUID NOT NULL REFERENCES podium_rounds(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES podium_products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (round_id, product_id)
);
ALTER TABLE podium_received ENABLE ROW LEVEL SECURITY;

ALTER TABLE podium_rounds ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;   -- receiving finished
ALTER TABLE podium_orders ADD COLUMN IF NOT EXISTS allocation JSONB;          -- { product_id: qty }
ALTER TABLE podium_orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE podium_orders ADD COLUMN IF NOT EXISTS delivered_by UUID;
