-- 224: the lane a run was GRADED on, saved once (QA 2026-11-27, Q27-3).
--
-- The feed ring (lib/feed/plan-verdicts.ts) and the run detail (api/academy/segments)
-- each resolved the lane themselves, from different traces, and the bands-only chart a
-- teammate sees drew the assigned lane — so one run could carry two lanes on two screens.
-- The first surface to resolve it writes it here; every surface reads it back.
-- Distinct from ran_lane (221), which is the runner's own "I ran with pack N".
-- lane_source: manual | attendance | watch | assigned (lib/plan-execution/ran-lane.ts).
-- A stored 'assigned' may be upgraded later by evidence; a rebuilt match row starts NULL
-- and is resolved again on its next read. Paste by hand. Idempotent.

ALTER TABLE activity_plan_matches
  ADD COLUMN IF NOT EXISTS resolved_lane SMALLINT,
  ADD COLUMN IF NOT EXISTS lane_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_plan_matches_resolved_lane_check') THEN
    ALTER TABLE activity_plan_matches
      ADD CONSTRAINT activity_plan_matches_resolved_lane_check CHECK (resolved_lane IS NULL OR resolved_lane BETWEEN 1 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_plan_matches_lane_source_check') THEN
    ALTER TABLE activity_plan_matches
      ADD CONSTRAINT activity_plan_matches_lane_source_check CHECK (lane_source IS NULL OR lane_source IN ('manual', 'attendance', 'watch', 'assigned'));
  END IF;
END $$;
