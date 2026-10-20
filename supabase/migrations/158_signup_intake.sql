-- 158_signup_intake.sql
--
-- The unified sign-up (mockup ~/.cache/madregot/join-flow-mockup.html, Ofer 2026-10-20):
-- a club request now carries the best time (marathon first, else half / 10 / 5), how
-- they came to us and who, and whether the academy interests them — as one object
-- (lib/join/intake.ts), so the queue can show who the person is.

ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS intake JSONB;
