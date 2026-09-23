-- A short, shareable number for every report ("#84"), so a bug can be named in
-- a WhatsApp message instead of described again. Existing reports are numbered
-- by date (the oldest is #1); every new one takes the next number.
-- Run by hand in the Supabase SQL editor as ONE block, without these comments.
-- The app reads the column defensively (42703 retries), so it can ship first.
CREATE SEQUENCE IF NOT EXISTS feedback_ticket_no_seq;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ticket_no bigint;
UPDATE feedback f SET ticket_no = s.n FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM feedback) s WHERE f.id = s.id AND f.ticket_no IS NULL;
SELECT setval('feedback_ticket_no_seq', COALESCE((SELECT max(ticket_no) FROM feedback), 0) + 1, false);
ALTER TABLE feedback ALTER COLUMN ticket_no SET DEFAULT nextval('feedback_ticket_no_seq');
ALTER SEQUENCE feedback_ticket_no_seq OWNED BY feedback.ticket_no;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_ticket_no_key ON feedback(ticket_no);
