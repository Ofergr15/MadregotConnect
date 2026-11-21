-- 191 — runner feedback + pain reports, and a reusable feature-enablement table.
--
-- Paste by hand in the Supabase SQL editor (no runner). Idempotent: every
-- statement is IF NOT EXISTS / ON CONFLICT DO NOTHING. Depends on 186
-- (athletes.availability) only at runtime; nothing here references it.
--
-- FK discipline (CLAUDE.md, migration 125): each new table has AT MOST ONE
-- REFERENCES athletes. Every "who did it" column (set_by, seen_by, resolved_by,
-- sender_id) is TEXT on purpose, so no athletes embed becomes ambiguous.

-- ── 1. Feature enablement (gated rollout, OFF unless a row says otherwise) ──────
CREATE TABLE IF NOT EXISTS feature_enablements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature     TEXT NOT NULL,
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('athlete','squad','academy','role','club')),
  -- athlete id | groups.id | 'academy' | role name | '*'
  scope_id    TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL,
  set_by      TEXT NOT NULL,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (feature, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS feature_enablements_feature_idx ON feature_enablements (feature);

-- Every toggle, append-only. `enabled` NULL = the row was cleared (back to inherit).
CREATE TABLE IF NOT EXISTS feature_enablement_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature     TEXT NOT NULL,
  scope_type  TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  enabled     BOOLEAN,
  previous    BOOLEAN,
  set_by      TEXT NOT NULL,
  set_by_name TEXT,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_enablement_audit_idx ON feature_enablement_audit (feature, set_at DESC);

-- ── 2. workout_feedback: vs-plan, soft withdraw, edit, seen ─────────────────────
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS vs_plan TEXT
  CHECK (vs_plan IS NULL OR vs_plan IN ('easier','as_planned','harder','unfinished'));
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE workout_feedback ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;

-- ── 3. Pain reports ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pain_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  area          TEXT NOT NULL,
  side          TEXT CHECK (side IS NULL OR side IN ('left','right','both')),
  severity      INT NOT NULL CHECK (severity BETWEEN 1 AND 10),
  since         TEXT NOT NULL,
  effect        TEXT NOT NULL CHECK (effect IN ('none','altered','stopped','cannot_run')),
  note          TEXT,
  activity_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','withdrawn')),
  resolved_by   TEXT,           -- 'runner' | staff athlete id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at     TIMESTAMPTZ,
  withdrawn_at  TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  seen_at       TIMESTAMPTZ,
  seen_by       TEXT,
  last_followup_on DATE,        -- Israel date of the last follow-up question
  escalated_at  TIMESTAMPTZ     -- the 14-day "no check-in" alert to staff
);
CREATE INDEX IF NOT EXISTS pain_reports_athlete_idx ON pain_reports (athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pain_reports_open_idx ON pain_reports (status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS pain_checkins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES pain_reports(id) ON DELETE CASCADE,
  trend       TEXT NOT NULL CHECK (trend IN ('better','same','worse','gone')),
  severity    INT CHECK (severity IS NULL OR severity BETWEEN 1 AND 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pain_checkins_report_idx ON pain_checkins (report_id, created_at);

-- Staff replies to a report (and the runner's answers), one thread per report.
CREATE TABLE IF NOT EXISTS pain_report_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES pain_reports(id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL,
  from_staff  BOOLEAN NOT NULL DEFAULT false,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pain_report_messages_idx ON pain_report_messages (report_id, created_at);

-- ── 4. Feedback prompts — one row per evaluated run (also the sampling history) ─
CREATE TABLE IF NOT EXISTS feedback_prompts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  activity_id   TEXT NOT NULL,   -- garmin_activity_id
  planned_kind  TEXT,            -- quality | long | easy | other | NULL (unplanned)
  mode          TEXT NOT NULL CHECK (mode IN ('none','quiet','card')),
  pushed        BOOLEAN NOT NULL DEFAULT false,
  pushed_on     DATE,
  held          TEXT,
  answered_at   TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, activity_id)
);
CREATE INDEX IF NOT EXISTS feedback_prompts_athlete_idx ON feedback_prompts (athlete_id, created_at DESC);

-- Service role only, like every table here: RLS on, no policies.
ALTER TABLE feature_enablements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_enablement_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE pain_reports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pain_checkins            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pain_report_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_prompts         ENABLE ROW LEVEL SECURITY;

-- ── 5. Routing: pain_report is its own kind (staff roles only, never runner) ────
-- Routing can only NARROW the coach scope (lib/feedback/pain.ts resolvePainRecipients).
INSERT INTO notification_routing (kind, role, enabled) VALUES
  ('pain_report', 'admin', true),
  ('pain_report', 'coach', true),
  ('pain_report', 'academy_coach', true)
ON CONFLICT (kind, role) DO NOTHING;
