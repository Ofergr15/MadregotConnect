-- 164: a poll whose names are hidden from the members (staff still see who chose what).
-- Off by default: names are shown, as they have been since 2026-10-16.
-- Paste as one block in the Supabase SQL editor; safe to run twice.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false;
