-- Coach → athlete reply on post-workout feedback. Athletes submit feedback
-- (difficulty/feel/pain/comment); this lets a coach write back a short reply the
-- athlete sees on their feedback screen — closing the loop. One reply per
-- feedback row (the row is already UNIQUE per athlete+activity); a full thread
-- would need a separate table.
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS coach_reply TEXT;
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS coach_reply_at TIMESTAMPTZ;
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS coach_reply_by TEXT; -- coach email
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS reply_seen_at TIMESTAMPTZ; -- athlete opened it
