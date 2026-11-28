-- 346_group_chat_message_audit.sql — task 181. Idempotent.
--
-- One row per edit or delete of a group chat message (the message itself lives in Stream).
-- Written by PATCH/DELETE /api/group-chat/messages BEFORE the Stream call, so a change can't land
-- unrecorded. old_text keeps what the room saw, so a "deleted for everyone" message can still be
-- read back by staff if it is ever disputed. Service role only.

CREATE TABLE IF NOT EXISTS group_chat_message_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           text NOT NULL,
  message_id         text NOT NULL,
  action             text NOT NULL CHECK (action IN ('edit', 'delete')),
  actor_athlete_id   uuid,
  actor_as           text NOT NULL CHECK (actor_as IN ('author', 'staff')),
  author_athlete_id  uuid,
  old_text           text,
  new_text           text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_chat_message_audit_message_idx ON group_chat_message_audit (message_id, created_at);
CREATE INDEX IF NOT EXISTS group_chat_message_audit_group_idx ON group_chat_message_audit (group_id, created_at DESC);

ALTER TABLE group_chat_message_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  REVOKE ALL ON TABLE group_chat_message_audit FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
GRANT ALL ON TABLE group_chat_message_audit TO service_role;
