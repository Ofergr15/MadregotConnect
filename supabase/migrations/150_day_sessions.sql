-- "אימון ליום אחד" (mockup manual-day-workout): one club session for one date, typed by
-- the coach when there is no weekly plan yet, with the nutrition for that session only.
--
-- One row per date (UNIQUE session_date): the form edits or unpublishes the date's row.
-- steps holds the quick-text parse (lib/academy/quick-text.ts QuickStep[]) and quick_text
-- the coach's own words; pack_paces is [pack1, pack2, pack3] rep pace in sec/km or null;
-- nutrition is [{ when: before|during|after, text }].
--
-- notified_at is the push's idempotency claim: the publish sets it with
-- `WHERE notified_at IS NULL`, and only the request that wins the claim sends.
--
-- created_by / updated_by carry no foreign key on purpose (schemaEmbedAmbiguity.test.ts).
--
-- OPTIONAL until pasted: without it the coach form says the table is missing and the
-- feed shows nothing.

CREATE TABLE IF NOT EXISTS day_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date DATE NOT NULL UNIQUE,
  start_time TIME,
  place TEXT,
  title TEXT NOT NULL DEFAULT '',
  quick_text TEXT NOT NULL DEFAULT '',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  pack_paces JSONB NOT NULL DEFAULT '[null,null,null]'::jsonb,
  nutrition JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  notify BOOLEAN NOT NULL DEFAULT true,
  notified_at TIMESTAMPTZ,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE day_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE day_sessions FROM anon, authenticated;
GRANT ALL ON TABLE day_sessions TO service_role;
