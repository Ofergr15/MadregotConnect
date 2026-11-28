-- 250 — store order status events: the reason for a skip or a back-step (round-4 task 84).
-- Paste by hand AFTER 231. Idempotent; safe to paste twice.
-- PATCH /api/admin/store/orders/[id] requires a reason for any transition outside the normal
-- forward path (pending_payment → paid → fulfilled, or → cancelled before fulfilment) and
-- stores it here. Until 250 is applied the status change still stands and the reason is
-- logged to the function log instead.
ALTER TABLE IF EXISTS store_order_status_events ADD COLUMN IF NOT EXISTS reason text;

-- VERIFY (expect 1 row):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'store_order_status_events' AND column_name = 'reason';
