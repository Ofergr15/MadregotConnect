-- 270_athlete_activities_changed_at.sql — task 100 (weekly volume cache). FILE ONLY, paste by hand.
--
-- A per-athlete "my activities changed" stamp, bumped by the database itself on every insert,
-- update or delete of an athlete_activities row. The weekly-volume cache keys on it, so a new
-- run, an edit or a delete invalidates that athlete's cached weeks on every server instance at
-- once — whichever of the ~35 code paths that write athlete_activities did it.
--
-- Statement-level triggers with transition tables: a sync that inserts 50 runs bumps each
-- athlete once, not 50 times. Idempotent: safe to paste twice.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS activities_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN athletes.activities_changed_at IS
  'Bumped by trigger on any athlete_activities insert/update/delete for this athlete. Cache key for weekly volume (lib/athletes/weekly-volume-cache.ts). NULL = never bumped since migration 270.';

CREATE OR REPLACE FUNCTION bump_activities_changed_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE athletes a SET activities_changed_at = clock_timestamp()
      WHERE a.id IN (SELECT DISTINCT athlete_id FROM new_rows WHERE athlete_id IS NOT NULL);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE athletes a SET activities_changed_at = clock_timestamp()
      WHERE a.id IN (SELECT DISTINCT athlete_id FROM old_rows WHERE athlete_id IS NOT NULL);
  ELSE
    UPDATE athletes a SET activities_changed_at = clock_timestamp()
      WHERE a.id IN (
        SELECT athlete_id FROM new_rows WHERE athlete_id IS NOT NULL
        UNION SELECT athlete_id FROM old_rows WHERE athlete_id IS NOT NULL
      );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS athlete_activities_changed_ins ON athlete_activities;
CREATE TRIGGER athlete_activities_changed_ins
  AFTER INSERT ON athlete_activities REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bump_activities_changed_at();

DROP TRIGGER IF EXISTS athlete_activities_changed_upd ON athlete_activities;
CREATE TRIGGER athlete_activities_changed_upd
  AFTER UPDATE ON athlete_activities REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bump_activities_changed_at();

DROP TRIGGER IF EXISTS athlete_activities_changed_del ON athlete_activities;
CREATE TRIGGER athlete_activities_changed_del
  AFTER DELETE ON athlete_activities REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bump_activities_changed_at();
