-- Upgrades post-workout feedback from a single one-shot coach reply
-- (036_workout_feedback_coach_reply.sql — whose own comment already flagged
-- "a full thread would need a separate table") into a real back-and-forth
-- thread between the athlete and staff. Roadmap #1, Personal Chat &
-- Feedback System — scoped to text only for v1 (no photo/video/voice, no
-- read receipts beyond "has the other side read past this point").
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS workout_feedback_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feedback_id UUID NOT NULL REFERENCES workout_feedback(id) ON DELETE CASCADE,
  sender_athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_feedback_messages_feedback
  ON workout_feedback_messages (feedback_id, created_at);

ALTER TABLE workout_feedback_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages feedback messages" ON workout_feedback_messages;
CREATE POLICY "Service role manages feedback messages"
  ON workout_feedback_messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Per-viewer-side last-read stamps on the feedback row itself (not a
-- per-message read table — a thread this short doesn't need one). "Has
-- unread messages" = latest message's created_at > my side's last-read.
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS athlete_last_read_at TIMESTAMPTZ;
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS coach_last_read_at TIMESTAMPTZ;

-- One-time backfill: the existing single coach_reply becomes the thread's
-- first message, so no history is lost. Only runs for rows that have a
-- reply AND whose replying coach's email still resolves to a real athlete
-- row (best-effort — a reply from a since-removed account is simply not
-- backfilled rather than blocking the migration).
INSERT INTO workout_feedback_messages (feedback_id, sender_athlete_id, body, created_at)
SELECT wf.id, a.id, wf.coach_reply, wf.coach_reply_at
FROM workout_feedback wf
JOIN athletes a ON a.email = wf.coach_reply_by
WHERE wf.coach_reply IS NOT NULL AND wf.coach_reply_at IS NOT NULL
ON CONFLICT DO NOTHING;

-- Carry over the athlete's existing "seen" stamp so a previously-read reply
-- doesn't show as a new unread message post-upgrade.
UPDATE workout_feedback SET athlete_last_read_at = reply_seen_at WHERE reply_seen_at IS NOT NULL;
