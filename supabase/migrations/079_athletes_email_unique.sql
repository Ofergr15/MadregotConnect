-- ═══════════════════════════════════════════════════════════════════════════
-- 079 — Reconcile athletes.email uniqueness with production
--
-- PRODUCTION ALREADY HAS THIS INDEX. On the live database this migration is a
-- no-op and prints a notice — it is safe (and expected) to run anyway.
--
-- The checked-in schema had drifted from prod: both supabase/schema.sql and
-- supabase/bootstrap.sql declare `email TEXT NOT NULL` with no uniqueness, but
-- prod enforces it. That matters because /api/auth/resolve-role — the route
-- every sign-in goes through — creates new athletes with
--
--     .upsert({ ... }, { onConflict: 'email', ignoreDuplicates: true })
--
-- and Postgres can only resolve ON CONFLICT against a unique index. So the
-- sign-in path works in prod and would fail with 42P10 ("there is no unique or
-- exclusion constraint matching the ON CONFLICT specification") on any database
-- built from the checked-in schema — a staging copy, a local Supabase, or a
-- restore. This closes that gap in both directions: the CREATE TABLE statements
-- now carry UNIQUE, and this migration adds the index to databases that already
-- exist without it.
--
-- Uniqueness on email is also what keeps duplicate-athlete rows from coming
-- back. resolve-role now tolerates duplicates (it reads the whole set and picks
-- the best row rather than calling .maybeSingle(), which errors on more than one
-- row and used to make a duplicated athlete read as a brand-new user), but
-- tolerating them is the safety net, not the intent.
--
-- Case sensitivity matches prod: a plain index on `email`, not on lower(email).
-- The app lowercases every address before it reads or writes, so this is
-- sufficient in practice; making the index expression-based would silently stop
-- matching `onConflict: 'email'`.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  existing_index text;
  dup_count      int;
BEGIN
  -- Any full-table, single-column unique index or constraint on `email` will do.
  -- Prod's is not necessarily named the way we would name it, so detect by shape
  -- rather than by name: exactly one key column, that column is `email`, no
  -- expression, no WHERE clause.
  SELECT ic.relname INTO existing_index
    FROM pg_index i
    JOIN pg_class  c  ON c.oid = i.indrelid
    JOIN pg_class  ic ON ic.oid = i.indexrelid
   WHERE c.relname = 'athletes'
     AND c.relnamespace = 'public'::regnamespace
     AND i.indisunique
     AND i.indnkeyatts = 1
     AND i.indexprs IS NULL
     AND i.indpred  IS NULL
     AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                         WHERE attrelid = c.oid AND attname = 'email' AND NOT attisdropped)
   LIMIT 1;

  IF existing_index IS NOT NULL THEN
    RAISE NOTICE '079: athletes.email is already unique (index %) — nothing to do.', existing_index;
    RETURN;
  END IF;

  -- Fail loudly and change nothing if the data can't support the index. Silently
  -- skipping would leave the sign-in upsert broken on this database with no sign
  -- of why; the duplicates have to be merged by hand because only a human knows
  -- which row's activities and plans are the real ones.
  SELECT count(*) INTO dup_count
    FROM (SELECT email FROM athletes GROUP BY email HAVING count(*) > 1) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      '079: cannot make athletes.email unique — % email address(es) appear on more than one row. Merge them first, then re-run. To see them: SELECT email, count(*), array_agg(id) FROM athletes GROUP BY email HAVING count(*) > 1;',
      dup_count;
  END IF;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS athletes_email_unique ON athletes (email)';
  RAISE NOTICE '079: created unique index athletes_email_unique on athletes (email).';
END $$;
