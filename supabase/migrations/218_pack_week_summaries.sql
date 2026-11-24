-- 218: the weekly digest of one pack's chat (flag academy_pack_chat). Written by cron/tick on
-- Sunday 07:00 Israel for the plan week (Sunday) that just closed; deterministic, no LLM.
-- Staff-only read (GET /api/packs/:id/week-summary): items can carry pain reports on a named
-- member. The chat itself is a Stream channel (`academy-pack-<packId>`), so no thread table
-- changes are needed. pack_id has no FK (schemaEmbedAmbiguity.test.ts). Paste by hand. Idempotent.

CREATE TABLE IF NOT EXISTS pack_week_summaries (
  pack_id     UUID NOT NULL,
  week_start  DATE NOT NULL,                 -- the PLAN week (Sunday)
  msg_by_day  JSONB NOT NULL DEFAULT '[0,0,0,0,0,0,0]'::jsonb,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  attendance  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, week_start)
);

ALTER TABLE pack_week_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pack_week_summaries FROM anon, authenticated;
GRANT ALL ON TABLE pack_week_summaries TO service_role;
