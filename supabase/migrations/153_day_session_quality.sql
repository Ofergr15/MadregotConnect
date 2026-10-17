-- "אימון ליום אחד" · "אימון איכות": a club session people RSVP to (the card asks who is
-- coming). False: a run on your own, no RSVP. OPTIONAL until pasted: lib/day-session/server.ts
-- reads and writes without it, and every session reads as quality (the card it always had).
ALTER TABLE day_sessions ADD COLUMN IF NOT EXISTS quality BOOLEAN;
NOTIFY pgrst, 'reload schema';
