-- Phase 1 (Profile Foundation) follow-up: shirt size was already collected
-- for Academy registrants (academy_intake JSON, migration 023) but there was
-- no way for a regular club member to set it — promoting it to a real column
-- so every athlete can set it from Settings → Personal Info, same as
-- birth_date/gender/shoe_size (migration 057).
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS shirt_size TEXT
  CHECK (shirt_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL'));
