-- 187 · Native weekly plan builder (design/plan-builder-prototype/BUILD-BRIEF.md)
-- Apply MANUALLY in the Supabase SQL editor. Idempotent. Every route that reads these
-- tables answers 503 { code: 'migration_pending' } until it is applied, and the existing
-- /api/plans + /api/garmin/push-workouts paths keep working untouched either way.
--
-- No new REFERENCES to `athletes` from a table that already references it twice, so no
-- unhinted embed becomes ambiguous (schemaEmbedAmbiguity.test.ts).

-- 1. Async parse jobs — the phone posts the file and polls; the parse runs after the reply.
CREATE TABLE IF NOT EXISTS plan_parse_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID,                         -- athletes.id of the staff caller (no FK: keep embeds unambiguous)
  week_start    DATE NOT NULL,                -- plan week (Sunday)
  input_kind    TEXT NOT NULL CHECK (input_kind IN ('image','pdf','text')),
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  stage         TEXT,                         -- 'upload' | 'reading' | 'structuring' | 'checking'
  result        JSONB,                        -- ParsedWeeklyPlan + flags/source + missingDays
  error_code    TEXT,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_parse_jobs_created_idx ON plan_parse_jobs (created_at DESC);

-- 2. Versions. One row per saved body; the draft is the highest unpublished version.
CREATE TABLE IF NOT EXISTS weekly_plan_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start     DATE NOT NULL,
  plan_id        UUID,                        -- weekly_plans.id once published (group-wide plan)
  version        INT  NOT NULL,
  body           JSONB NOT NULL,              -- { workouts: ParsedWorkout[] }
  source         JSONB,                       -- { jobId?, kind, pages? } for jump-to-source
  state          TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','scheduled','published','superseded','unpublished')),
  publish_at     TIMESTAMPTZ,                 -- scheduled publish (cron/tick)
  publish_opts   JSONB,                       -- { notify, push, overwriteWatch, message }
  published_at   TIMESTAMPTZ,
  published_by   UUID,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_start, version)
);
CREATE INDEX IF NOT EXISTS weekly_plan_versions_due_idx ON weekly_plan_versions (publish_at) WHERE state = 'scheduled';

-- 3. Per-athlete Garmin push status for a version.
CREATE TABLE IF NOT EXISTS plan_push_status (
  athlete_id   UUID NOT NULL,
  version_id   UUID NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('pending','sent','failed','reconnect','backoff','skipped')),
  error_code   TEXT,
  error        TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  retry_at     TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, version_id)
);

-- 4. Soft edit lock, one row per plan week; stale after PLAN_LOCK_TTL_SEC (~2 min).
CREATE TABLE IF NOT EXISTS plan_edit_locks (
  week_start           DATE PRIMARY KEY,
  editor_id            UUID NOT NULL,
  editor_name          TEXT,
  heartbeat_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  release_requested_by TEXT,
  release_requested_at TIMESTAMPTZ
);

-- 5. Staff copy of a change-after-publish notice is a routed management kind.
INSERT INTO notification_routing (kind, role, enabled)
SELECT 'plan_changed', r, true FROM (VALUES ('admin'),('coach')) v(r)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_routing')
ON CONFLICT DO NOTHING;

ALTER TABLE plan_parse_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plan_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_push_status      ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_edit_locks       ENABLE ROW LEVEL SECURITY;
