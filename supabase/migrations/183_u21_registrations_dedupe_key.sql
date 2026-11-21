-- 183: u21_registrations — a dedupe key that closes the concurrent double-submit race.
-- NOT APPLIED. Paste by hand in the Supabase SQL editor (after 180). Idempotent.
--
-- POST /api/u21/register dedupes "same email + track within 10 minutes" by reading before it
-- inserts. Two identical submits landing on two instances at once both read "nothing" and
-- both insert. The route now also writes dedupe_key = lower(email) | track | 10-minute bucket
-- (u21DedupeKey in src/lib/u21/register-guard.ts); this unique index makes the second insert
-- fail with 23505, which the route answers with the same 200 as the first.
--
-- Why a new nullable column and not a unique index over existing columns:
--   * A unique expression index over (email, track, <time bucket of created_at>) cannot be
--     built — date_trunc/extract on timestamptz is not IMMUTABLE — and, worse, CREATE UNIQUE
--     INDEX fails outright if ANY existing rows already collide (the race this fixes may have
--     produced some), which would make this migration fail on paste.
--   * dedupe_key is NULL on every existing row, and NULLs never collide in a unique index, so
--     the index builds on any existing data. Only rows written by the new route carry a key.
-- Bucket, not sliding window: two submits straddling a bucket boundary still both land; the
-- route's sliding-window read catches that case whenever the two are not simultaneous.
-- Before this is pasted the route sees PGRST204/42703 for the column and inserts without it.

ALTER TABLE u21_registrations ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS u21_registrations_dedupe_key_uidx
  ON u21_registrations (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- The route's per-email reads (dedupe + hourly cap) filter by email and created_at.
CREATE INDEX IF NOT EXISTS u21_registrations_email_created_idx
  ON u21_registrations (email, created_at DESC);

COMMENT ON COLUMN u21_registrations.dedupe_key IS
  'lower(email)|track|floor(epoch_ms/600000), written by POST /api/u21/register. Unique when set: a concurrent identical submit gets 23505 and is answered as received. See migration 183.';
