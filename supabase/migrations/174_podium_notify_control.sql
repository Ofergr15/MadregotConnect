-- 174: הזמנת פודיום — the admin controls the "it's open" notification (Ofer 10-26).
--   auto_notify   send it by itself when the round opens (and to people added later); off = only by hand
--   notify_title / notify_body   the admin's own text (NULL = the default wording)
-- Paste as one block; safe to run twice. Needs 172.
ALTER TABLE podium_rounds ADD COLUMN IF NOT EXISTS auto_notify  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE podium_rounds ADD COLUMN IF NOT EXISTS notify_title TEXT;
ALTER TABLE podium_rounds ADD COLUMN IF NOT EXISTS notify_body  TEXT;
