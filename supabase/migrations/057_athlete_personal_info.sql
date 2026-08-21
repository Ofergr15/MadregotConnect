-- Phase 1 of the "missing parts" roadmap — Profile Foundation (#7 personal
-- info fields). Paired with a new "Personal Info" edit screen on Settings
-- (Profile's landing intentionally stays hero-only — see the roadmap doc).
--
-- gender is a fixed two-value set per an explicit product decision (not
-- free text) — keeps any future gender-based leaderboard filter (Phase 2)
-- simple to build against.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS shoe_size TEXT;
