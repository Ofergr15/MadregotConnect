-- Roadmap #15 gap: nothing ever reminded an athlete that a registration
-- window was closing (only a day-before-the-EVENT reminder existed). Nullable
-- and optional — most events don't need a hard cutoff separate from the
-- event date itself; a coach only sets this when registration genuinely
-- closes earlier (e.g. a race that stops accepting sign-ups a week out).
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_deadline DATE;
