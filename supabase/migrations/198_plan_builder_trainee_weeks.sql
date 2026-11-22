-- 198: plan-builder per-athlete (academy trainee) weeks. Owner decision 2026-11-22 (option A):
-- the versioned builder is the ONLY plan writer, for group weeks and individual weeks alike.
-- Pasted by hand in the Supabase SQL editor; idempotent.
--
-- athlete_id NULL = the group week (today's rows, unchanged). No FK on purpose: a second
-- path to `athletes` would make unhinted embeds ambiguous (schemaEmbedAmbiguity.test.ts).

-- 1. Versions: one stream per (week, athlete).
ALTER TABLE weekly_plan_versions ADD COLUMN IF NOT EXISTS athlete_id UUID;
ALTER TABLE weekly_plan_versions DROP CONSTRAINT IF EXISTS weekly_plan_versions_week_start_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS weekly_plan_versions_week_athlete_version_key
  ON weekly_plan_versions (week_start, COALESCE(athlete_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
CREATE INDEX IF NOT EXISTS weekly_plan_versions_athlete_idx
  ON weekly_plan_versions (athlete_id, week_start) WHERE athlete_id IS NOT NULL;

-- 2. Edit locks: one per (week, athlete), so editing a trainee's week never locks the group week.
--    Dropping the PK on week_start; in-flight locks (2-minute TTL) survive as rows.
ALTER TABLE plan_edit_locks ADD COLUMN IF NOT EXISTS athlete_id UUID;
ALTER TABLE plan_edit_locks ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE plan_edit_locks DROP CONSTRAINT IF EXISTS plan_edit_locks_pkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'plan_edit_locks'::regclass AND contype = 'p') THEN
    ALTER TABLE plan_edit_locks ADD PRIMARY KEY (id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS plan_edit_locks_week_athlete_key
  ON plan_edit_locks (week_start, COALESCE(athlete_id, '00000000-0000-0000-0000-000000000000'::uuid));
