-- 231 — store order status history: who changed an order's status, from what, to what, when (night task 56).
-- Paste by hand in the Supabase SQL editor. Idempotent; safe to paste twice.
-- Until applied, PATCH /api/admin/store/orders/[id] still updates the status (the history
-- write is skipped) and GET …/history answers 503.
--
-- Staff-only: RLS on with no policies, read and written by the service role through the
-- admin routes. `changed_by` is a bare uuid (no FK) — a second FK to athletes makes
-- unhinted embeds ambiguous (CLAUDE.md, migration 125).

CREATE TABLE IF NOT EXISTS store_order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('pending_payment', 'paid', 'fulfilled', 'cancelled')),
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_order_status_events_order_idx ON store_order_status_events (order_id, changed_at DESC);
ALTER TABLE store_order_status_events ENABLE ROW LEVEL SECURITY;  -- service role only

DO $$ BEGIN
  REVOKE ALL ON TABLE store_order_status_events FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
