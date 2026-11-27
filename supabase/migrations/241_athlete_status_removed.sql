-- Task 73 (DB types drift): `athlete_status` gains 'removed' IN THE FILES.
--
-- Production already has this value — the entry-queue "remove from club" action writes
-- status = 'removed' (src/lib/admin/entry-queue.ts REMOVED_STATUS) and migration 209
-- backfills removed_at for those rows — but no migration file ever added it, so a
-- database built from schema.sql + migrations would reject every removal.
-- This file records it. Idempotent: a no-op where the value exists.
--
-- ⚠️ Paste on its OWN. Postgres refuses to use a new enum value in the same
-- transaction that added it (55P04), so don't append a query that reads it.
-- Numbered 241: 225-239 were left for the parallel overnight queue; re-check first.

ALTER TYPE athlete_status ADD VALUE IF NOT EXISTS 'removed';

-- VERIFY (separately): SELECT enum_range(NULL::athlete_status);
-- ROLLBACK: not possible in Postgres (enum values cannot be dropped) — and not needed.
