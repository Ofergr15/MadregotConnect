-- ═══════════════════════════════════════════════════════════════════════════
-- 097 — Make the duplicate-merge repeatable, and let the APP run it
--
-- Migration 080 merged four duplicate athlete rows by hand. Two more have
-- appeared since (see the bottom of this file), and more will: a member who
-- joined by email and later signs in with Strava is the ordinary case, not an
-- edge one, and every time it happens somebody has to hand-write a repair.
--
-- So 080's merge body moves out of a one-off DO block and into a FUNCTION the
-- application can call. The point is that the app can now heal a duplicate the
-- moment it recognises one — on the duplicate's very next Strava login — instead
-- of the club waiting for a migration to be pasted into the SQL editor.
--
-- WHAT MERGE_ATHLETE_ROWS DOES, unchanged from 080 in behaviour:
--   1. Deletes the duplicate's copies of runs the real row already has — matched
--      on strava_activity_id, or a start_time within 5 minutes (the same run
--      imported once from Garmin and once from Strava).
--   2. Moves everything still pointing at the duplicate onto the real row, ONE
--      ROW AT A TIME, discovering the tables from the foreign-key catalog. A row
--      that collides with a natural key the real row already satisfies is written
--      to athlete_merge_discarded in full and dropped, rather than taking the
--      whole merge down. Every SQLSTATE-23 violation is caught; a genuine bug is
--      not.
--   3. Carries the Strava identity, the academy flag and the avatar onto the real
--      row without clobbering anything already there. data_source becomes
--      'strava' only when no Garmin credential is on file — flipping it otherwise
--      cuts a Garmin athlete off from Garmin sync AND from pushed workouts.
--   4. Deletes the duplicate athletes row.
--
-- WHAT IS NEW, and it is all about being safe to call unattended:
--
--   * p_require_synthetic_dup (default TRUE). The row being merged AWAY must hold
--     a synthetic strava_<id>@strava.madregot.local address — an address the app
--     invented for itself, which is by construction the newer, emptier row. This
--     is the guard that makes automatic merging defensible: whatever the caller
--     believes, this function will not delete a row keyed on a real human's own
--     email address unless a human explicitly passes FALSE. An admin merging two
--     real rows by hand is the only caller that may.
--   * It refuses to merge a row into itself, a row that does not exist, and a
--     duplicate that is flagged is_super_user (there is exactly one of those and
--     losing it locks the club's only super-user out).
--   * It returns jsonb — moved / discarded / twins_deleted / real_id — so the
--     caller can log what happened. The audit tables stay, because they are what
--     makes step 2 reversible, and RAISE NOTICE goes nowhere in Supabase's editor.
--
-- SECURITY DEFINER, and deliberately EXECUTE-revoked from anon and authenticated:
-- the app calls it with the service-role key from a server route that has already
-- verified who is asking. Nothing reachable from a browser may merge accounts.
--
-- Idempotent: a duplicate that is already gone returns {"skipped": "no_duplicate"}.
-- ═══════════════════════════════════════════════════════════════════════════

-- Named without a migration number, unlike 080's pair: these outlive this file
-- now, because the function writes to them on every merge the app performs.
CREATE TABLE IF NOT EXISTS athlete_merge_log (
  id             bigserial   PRIMARY KEY,
  ran_at         timestamptz NOT NULL DEFAULT now(),
  duplicate_id   uuid,
  duplicate_name text,
  real_id        uuid,
  -- Who or what asked for this merge: 'strava-login-reconcile', 'admin-link',
  -- 'migration-097'. The one field that tells you, six weeks later, whether a
  -- merge was a person's decision or the app's.
  reason         text,
  table_name     text,
  moved          int,
  discarded      int
);

CREATE TABLE IF NOT EXISTS athlete_merge_discarded (
  id           bigserial   PRIMARY KEY,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  table_name   text        NOT NULL,
  duplicate_id uuid        NOT NULL,
  real_id      uuid        NOT NULL,
  row_data     jsonb       NOT NULL
);

ALTER TABLE athlete_merge_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_merge_discarded ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION merge_athlete_rows(
  p_dup                    uuid,
  p_real                   uuid,
  p_reason                 text    DEFAULT 'manual',
  p_require_synthetic_dup  boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  dup_row     athletes;
  real_row    athletes;
  fk          record;
  row_ctids   tid[];
  ct          tid;
  n_deleted   int;
  n_moved     int := 0;
  n_dropped   int := 0;
  t_moved     int;
  t_dropped   int;
BEGIN
  IF p_dup IS NULL OR p_real IS NULL OR p_dup = p_real THEN
    RAISE EXCEPTION 'merge_athlete_rows: need two different athlete ids (got % and %)', p_dup, p_real;
  END IF;

  SELECT * INTO dup_row FROM athletes WHERE id = p_dup;
  IF NOT FOUND THEN
    -- Not an error: the caller may be a login that raced another login, or a
    -- re-run of this migration. Both mean the work is already done.
    RETURN jsonb_build_object('skipped', 'no_duplicate', 'duplicate_id', p_dup);
  END IF;

  SELECT * INTO real_row FROM athletes WHERE id = p_real;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_athlete_rows: target athlete % does not exist', p_real;
  END IF;

  -- The two guards that make this safe to call from a login handler.
  IF p_require_synthetic_dup
     AND dup_row.email !~* '^strava_[0-9]+@strava\.madregot\.local$' THEN
    RAISE EXCEPTION
      'merge_athlete_rows: refusing to merge away %, whose address (%) is a real one. Pass p_require_synthetic_dup => false only after a human has checked which row is which.',
      p_dup, dup_row.email;
  END IF;
  IF COALESCE(dup_row.is_super_user, false) THEN
    RAISE EXCEPTION 'merge_athlete_rows: refusing to delete the super-user row %', p_dup;
  END IF;

  -- 1. Drop the duplicate's copies of runs the real row already has.
  DELETE FROM athlete_activities a
   WHERE a.athlete_id = p_dup
     AND EXISTS (
           SELECT 1 FROM athlete_activities b
            WHERE b.athlete_id = p_real
              AND ((a.strava_activity_id IS NOT NULL
                    AND b.strava_activity_id = a.strava_activity_id)
                OR (a.start_time IS NOT NULL AND b.start_time IS NOT NULL
                    AND abs(extract(epoch FROM (b.start_time - a.start_time))) <= 300)));
  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  IF n_deleted > 0 THEN
    INSERT INTO athlete_merge_log (duplicate_id, duplicate_name, real_id, reason, table_name, moved, discarded)
      VALUES (p_dup, dup_row.name, p_real, p_reason, 'athlete_activities (twins)', 0, n_deleted);
  END IF;

  -- 2. Move whatever still points at the duplicate. See 080 for why this is row
  --    by row and why the table list comes from the FK catalog rather than by
  --    hand: a blind UPDATE aborts the merge on the first natural-key collision,
  --    and a table left out of a hand-written list is silently emptied by
  --    ON DELETE CASCADE in step 4.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.confrelid = 'public.athletes'::regclass
       AND c.contype = 'f'
       AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format('SELECT array_agg(ctid) FROM %s WHERE %I = $1', fk.tbl, fk.col)
       INTO row_ctids USING p_dup;
    CONTINUE WHEN row_ctids IS NULL;

    t_moved   := 0;
    t_dropped := 0;
    FOREACH ct IN ARRAY row_ctids LOOP
      BEGIN
        EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', fk.tbl, fk.col)
           USING p_real, ct;
        t_moved := t_moved + 1;
      -- The real row's copy wins, but the discarded one is kept IN FULL as jsonb
      -- first, so the choice is reversible.
      EXCEPTION WHEN integrity_constraint_violation
                  OR restrict_violation
                  OR not_null_violation
                  OR foreign_key_violation
                  OR unique_violation
                  OR check_violation
                  OR exclusion_violation THEN
        EXECUTE format(
          'INSERT INTO athlete_merge_discarded (table_name, duplicate_id, real_id, row_data) '
          'SELECT %L, $1, $2, to_jsonb(t) FROM %s t WHERE t.ctid = $3',
          fk.tbl::text, fk.tbl) USING p_dup, p_real, ct;
        EXECUTE format('DELETE FROM %s WHERE ctid = $1', fk.tbl) USING ct;
        t_dropped := t_dropped + 1;
      END;
    END LOOP;

    IF t_moved > 0 OR t_dropped > 0 THEN
      INSERT INTO athlete_merge_log (duplicate_id, duplicate_name, real_id, reason, table_name, moved, discarded)
        VALUES (p_dup, dup_row.name, p_real, p_reason, fk.tbl::text, t_moved, t_dropped);
    END IF;
    n_moved   := n_moved   + t_moved;
    n_dropped := n_dropped + t_dropped;
  END LOOP;

  -- 3. Carry the Strava identity over. The duplicate releases it first —
  --    strava_athlete_id is UNIQUE (053).
  UPDATE athletes SET strava_athlete_id = NULL, strava_auth = NULL WHERE id = p_dup;

  UPDATE athletes SET
      strava_auth       = COALESCE(strava_auth, dup_row.strava_auth),
      strava_athlete_id = COALESCE(strava_athlete_id, dup_row.strava_athlete_id),
      strava_enabled    = COALESCE(strava_enabled, false) OR COALESCE(dup_row.strava_enabled, false),
      is_academy        = COALESCE(is_academy, false) OR COALESCE(dup_row.is_academy, false),
      avatar_url        = COALESCE(avatar_url, dup_row.avatar_url),
      data_source       = CASE WHEN garmin_auth IS NULL THEN 'strava' ELSE data_source END
    WHERE id = p_real;

  -- 4. And the duplicate is gone. Its Supabase AUTH user is left alone on
  --    purpose: the synthetic strava_<id>@… user is the identity the member's
  --    Strava login signs in AS, and resolve-role maps it to the real row through
  --    the id encoded in that address. Deleting it would break their login.
  DELETE FROM athletes WHERE id = p_dup;

  INSERT INTO athlete_merge_log (duplicate_id, duplicate_name, real_id, reason, table_name, moved, discarded)
    VALUES (p_dup, dup_row.name, p_real, p_reason,
            format('athletes (merged into %s)', real_row.name), n_moved, n_deleted + n_dropped);

  RETURN jsonb_build_object(
    'merged',         true,
    'duplicate_id',   p_dup,
    'duplicate_name', dup_row.name,
    'real_id',        p_real,
    'real_name',      real_row.name,
    'twins_deleted',  n_deleted,
    'moved',          n_moved,
    'discarded',      n_dropped
  );
END $fn$;

-- Server routes only, holding the service-role key. Nothing a browser can reach
-- may merge two accounts.
REVOKE ALL ON FUNCTION merge_athlete_rows(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_athlete_rows(uuid, uuid, text, boolean) FROM anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- The two duplicates standing in production on 2026-09-07. Measured before
-- writing this, so you know what to expect:
--
--   אסף אלקסלסי   dup 35ac2418 (strava_60508376@…, 0 activities, no group,
--                 approved 16:27 today) → real 43eab385 (akonsta1313@gmail.com,
--                 178 activities, group 095cb7bf, Garmin, admin).
--                 Also 1 pending signup_requests row, moved by step 2.
--                 data_source stays 'garmin': Garmin owns his sync and is the
--                 only channel that can deliver a pushed workout.
--
--   Shahar Glazner dup 0000ecf6 (strava_17293893@…, 0 activities, never
--                 approved, holds a group assignment) → real 07ddc9ba
--                 (shaharglazner@gmail.com, 158 activities, Strava already
--                 linked). Nothing to carry — his Strava id is on the real row
--                 already, which is why this shell has a NULL one. It is an
--                 empty second "Shahar Glazner" in every list.
--
-- Both duplicates hold synthetic addresses, so the default guard applies and
-- neither call needs to weaken it.
-- ───────────────────────────────────────────────────────────────────────────
SELECT merge_athlete_rows(
  '35ac2418-7908-44df-8075-5cdd3d66faf9'::uuid,
  '43eab385-4a74-40fd-be50-b4beaaf05fd2'::uuid,
  'migration-097'
);

SELECT merge_athlete_rows(
  '0000ecf6-482a-4ee5-91dd-ecc8cd50f5ad'::uuid,
  '07ddc9ba-a0bd-41b3-a409-8f0e5b429b87'::uuid,
  'migration-097'
);

-- What the two calls above did:
--   SELECT ran_at, duplicate_name, table_name, moved, discarded, reason
--     FROM athlete_merge_log ORDER BY id DESC LIMIT 20;
