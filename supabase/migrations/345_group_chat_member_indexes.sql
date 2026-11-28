-- 345_group_chat_member_indexes.sql — task 180 (group chat read receipts / unread). Idempotent.
--
-- Every group-chat route (list, open, send, unread, read, receipts) starts by resolving who sits
-- in the room: packThreadMembers() reads athletes by group_id and every club coach by role.
-- Neither column had an index, so each chat request was two sequential scans of athletes.
-- The read receipts themselves live in Stream (one read point per channel member); nothing
-- here stores them.
--
-- Run each statement on its own in the SQL editor (CONCURRENTLY cannot run in a transaction).

CREATE INDEX CONCURRENTLY IF NOT EXISTS athletes_group_id_idx
  ON athletes (group_id) WHERE group_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS athletes_staff_role_idx
  ON athletes (role) WHERE role IN ('coach', 'academy_coach');
