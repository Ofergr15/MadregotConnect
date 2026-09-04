-- ═══════════════════════════════════════════════════════════════════════════
-- 080 — Merge the four duplicate athlete rows a Strava login created
--
-- DATA REPAIR, NOT SCHEMA. Read this header before running it.
--
-- Four members have two athletes rows each. The second row was created by the
-- Strava OAuth callback, which until v2.39.19 could only recognise a returning
-- athlete by `strava_athlete_id` — a column written BY a Strava login, so on a
-- member's first Strava login it was always NULL, nothing matched, and the
-- callback inserted a fresh row for somebody already on the roster:
--
--   duplicate (role 'runner', no group, onboarding 'pending')  real roster row
--   ────────────────────────────────────────────────────────  ─────────────────────────
--   6eb4de98  strava_106828158@strava.madregot.local           4e7d7c0f  Ofer G          admin
--   3f635fd0  strava_37085164@strava.madregot.local            23826580  Tal Borenstein  admin
--   462e2419  strava_17293893@strava.madregot.local            07ddc9ba  Shahar Glazner  admin
--   0c5e1bfd  strava_30573920@strava.madregot.local            feeac531  Sahar Azar      runner
--
-- Three of the four real rows are admins, so each of them was signing in as a
-- brand-new runner with no group, no history and no staff tools, and being asked
-- to connect their training data.
--
-- The code fix stops NEW duplicates. It cannot merge these four, because the
-- duplicate is the row that now carries the Strava identity — only a human can
-- say which row's data is the real one. Hence this file.
--
-- WHAT IT DOES, per pair:
--   1. Deletes the duplicate's activities that the real row already has —
--      matched on strava_activity_id, or on a start_time within 5 minutes (the
--      same run imported once from Garmin and once from Strava). Nobody starts
--      two recorded runs five minutes apart, so the window is safe.
--   2. Moves whatever is left onto the real row, plus anything else in the
--      database still pointing at the duplicate (discovered from the foreign-key
--      catalog, so schema drift can't leave an orphan behind).
--   3. Carries the duplicate's live Strava token, strava_athlete_id and
--      is_academy onto the real row, without clobbering anything already there.
--      data_source becomes 'strava' only when the real row has no Garmin
--      credentials — flipping it otherwise would cut a Garmin athlete off from
--      Garmin sync.
--   4. Deletes the duplicate athletes row.
--
-- Measured on production 2026-09-04, so you know what to expect:
--   Ofer    duplicate has 108 activities — ALL 108 already on the real row → 0 moved
--   Tal     duplicate has  76 activities — 66 already there, 10 genuinely new → 10 moved
--   Shahar  duplicate has 158 activities — ALL 158 already on the real row → 0 moved
--   Sahar   duplicate has   0 activities                                    → 0 moved
--   Nothing else in the database points at any of the four duplicates.
--
-- The duplicates' Supabase AUTH users are deliberately left alone: the synthetic
-- strava_<id>@strava.madregot.local user is the identity a Strava login signs in
-- as, and from v2.39.19 resolve-role maps it to the real row through the id
-- encoded in that address. Deleting them would break these members' logins.
--
-- Idempotent: re-running after a successful run finds no duplicate rows and does
-- nothing. Safe to run before or after 054 and 079. Note that 079 (unique index
-- on athletes.email) is unaffected either way — the duplicates hold synthetic
-- addresses, not repeated ones.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- DRY RUN. Run this on its own first and check the numbers against the table
-- above. It changes nothing.
-- ───────────────────────────────────────────────────────────────────────────
WITH pairs(dup_id, real_id) AS (
  VALUES ('6eb4de98-270e-4ddd-9161-db71fff031f7'::uuid, '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81'::uuid),
         ('3f635fd0-f339-41e1-b283-a914e6c687f0'::uuid, '23826580-36e9-43d7-8094-783fa57b3bf8'::uuid),
         ('462e2419-b165-4795-84b6-aee50bd2eb08'::uuid, '07ddc9ba-a0bd-41b3-a409-8f0e5b429b87'::uuid),
         ('0c5e1bfd-b67a-4681-9677-f48c37cd478e'::uuid, 'feeac531-9661-4713-ad76-a9003818abee'::uuid)
)
SELECT d.name                AS duplicate,
       d.email               AS duplicate_email,
       r.name                AS real_row,
       r.email               AS real_email,
       r.role                AS real_role,
       (SELECT count(*) FROM athlete_activities a WHERE a.athlete_id = p.dup_id)  AS dup_activities,
       (SELECT count(*) FROM athlete_activities a
         WHERE a.athlete_id = p.dup_id
           AND EXISTS (SELECT 1 FROM athlete_activities b
                        WHERE b.athlete_id = p.real_id
                          AND ((a.strava_activity_id IS NOT NULL
                                AND b.strava_activity_id = a.strava_activity_id)
                            OR (a.start_time IS NOT NULL AND b.start_time IS NOT NULL
                                AND abs(extract(epoch FROM (b.start_time - a.start_time))) <= 300))))
                                                                                  AS will_be_deleted
  FROM pairs p
  JOIN athletes d ON d.id = p.dup_id
  JOIN athletes r ON r.id = p.real_id;

-- ───────────────────────────────────────────────────────────────────────────
-- THE MERGE.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- (duplicate row, real roster row). Explicit rather than matched by name at
  -- runtime: each pair was verified against production by hand, and a
  -- name-matching sweep is exactly the kind of thing that merges two different
  -- people the day two members share a name.
  pairs CONSTANT uuid[][] := ARRAY[
    ['6eb4de98-270e-4ddd-9161-db71fff031f7', '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81'], -- Ofer
    ['3f635fd0-f339-41e1-b283-a914e6c687f0', '23826580-36e9-43d7-8094-783fa57b3bf8'], -- Tal
    ['462e2419-b165-4795-84b6-aee50bd2eb08', '07ddc9ba-a0bd-41b3-a409-8f0e5b429b87'], -- Shahar
    ['0c5e1bfd-b67a-4681-9677-f48c37cd478e', 'feeac531-9661-4713-ad76-a9003818abee']  -- Sahar
  ]::uuid[][];
  pair        uuid[];
  dup_id      uuid;
  real_id     uuid;
  dup_row     athletes;
  real_name   text;
  fk          record;
  n_deleted   int;
  n_moved     int;
  n_this      int;
  n_repointed int;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    dup_id  := pair[1];
    real_id := pair[2];

    SELECT * INTO dup_row FROM athletes WHERE id = dup_id;
    IF NOT FOUND THEN
      RAISE NOTICE '080: duplicate % already merged — skipping.', dup_id;
      CONTINUE;
    END IF;

    SELECT name INTO real_name FROM athletes WHERE id = real_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '080: real row % not found for duplicate % — check the pair list.',
        real_id, dup_id;
    END IF;

    -- 1. Drop the duplicate's copies of runs the real row already has.
    DELETE FROM athlete_activities a
     WHERE a.athlete_id = dup_id
       AND EXISTS (
             SELECT 1 FROM athlete_activities b
              WHERE b.athlete_id = real_id
                AND ((a.strava_activity_id IS NOT NULL
                      AND b.strava_activity_id = a.strava_activity_id)
                  OR (a.start_time IS NOT NULL AND b.start_time IS NOT NULL
                      AND abs(extract(epoch FROM (b.start_time - a.start_time))) <= 300)));
    GET DIAGNOSTICS n_deleted = ROW_COUNT;

    -- 2. Move what's left.
    UPDATE athlete_activities SET athlete_id = real_id WHERE athlete_id = dup_id;
    GET DIAGNOSTICS n_moved = ROW_COUNT;

    -- Then everything else that references the duplicate. Read from the catalog
    -- rather than a hand-written table list: the checked-in schema has drifted
    -- from production before, and a table left out here would be silently
    -- deleted by ON DELETE CASCADE in step 4.
    n_repointed := 0;
    FOR fk IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.confrelid = 'public.athletes'::regclass
         AND c.contype = 'f'
         AND array_length(c.conkey, 1) = 1
         AND c.conrelid <> 'public.athlete_activities'::regclass
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col)
         USING real_id, dup_id;
      GET DIAGNOSTICS n_this = ROW_COUNT;
      IF n_this > 0 THEN
        n_repointed := n_repointed + n_this;
        RAISE NOTICE '080:   re-pointed % row(s) in %.%', n_this, fk.tbl, fk.col;
      END IF;
    END LOOP;

    -- 3. Carry the Strava identity over. The duplicate has to release its
    --    strava_athlete_id first — the column is UNIQUE (see 053).
    UPDATE athletes SET strava_athlete_id = NULL, strava_auth = NULL WHERE id = dup_id;

    UPDATE athletes SET
        strava_auth       = COALESCE(strava_auth, dup_row.strava_auth),
        strava_athlete_id = COALESCE(strava_athlete_id, dup_row.strava_athlete_id),
        strava_enabled    = COALESCE(strava_enabled, false) OR COALESCE(dup_row.strava_enabled, false),
        is_academy        = COALESCE(is_academy, false) OR COALESCE(dup_row.is_academy, false),
        avatar_url        = COALESCE(avatar_url, dup_row.avatar_url),
        -- Strava only becomes the source of truth when nothing else is connected.
        data_source       = CASE WHEN garmin_auth IS NULL THEN 'strava' ELSE data_source END
      WHERE id = real_id;

    -- 4. And the duplicate is gone.
    DELETE FROM athletes WHERE id = dup_id;

    RAISE NOTICE '080: merged the % duplicate into % — % duplicate activities deleted, % moved, % other row(s) re-pointed.',
      dup_row.name, real_name, n_deleted, n_moved, n_repointed;
  END LOOP;

  PERFORM 1 FROM athletes WHERE email LIKE 'strava\_%@strava.madregot.local';
  IF FOUND THEN
    RAISE NOTICE '080: heads up — some athletes rows still hold a synthetic strava address. That is expected only for a member who is genuinely not on the roster. To see them: SELECT id, name, email FROM athletes WHERE email LIKE ''strava\_%%@strava.madregot.local'';';
  END IF;
END $$;
