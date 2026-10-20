-- Stories phase 2 (design: madregot-stories-admin-design.md, Ofer 2026-10-19).
-- 1. story_instances: one row per athlete x feature x period (birthday date / Dec 31 /
--    the weekly Saturday). Holds the admin's per-person overrides and the marks.
--    Overrides can only NARROW what storyGate opens: enabled=false / skipped close one
--    person's story, feed_post=false drops the public post; nothing here opens a story
--    the gate keeps closed. The UNIQUE key makes the cron idempotent (pushed_at claim).
-- 2. athletes.story_prefs: the athlete's own opt-outs. Missing key = on.
--    {"weekly":false,"birthday":false,"annual":false,"birthday_feed_post":false}
-- Idempotent: safe to paste twice. RLS on, no policies = service role only.
CREATE TABLE IF NOT EXISTS story_instances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  feature       TEXT NOT NULL CHECK (feature IN ('weekly','birthday','annual')),
  period        DATE NOT NULL,
  publish_at    TIMESTAMPTZ,
  display_days  SMALLINT CHECK (display_days BETWEEN 1 AND 31),
  feed_post     BOOLEAN,
  custom_text   JSONB,
  slide_order   JSONB,
  enabled       BOOLEAN,
  skipped       BOOLEAN NOT NULL DEFAULT false,
  updated_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  pushed_at     TIMESTAMPTZ,
  viewed_at     TIMESTAMPTZ,
  shared_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, feature, period)
);
CREATE INDEX IF NOT EXISTS story_instances_feature_period_idx ON story_instances (feature, period DESC);
ALTER TABLE story_instances ENABLE ROW LEVEL SECURITY;

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS story_prefs JSONB;
COMMENT ON COLUMN athletes.story_prefs IS 'Per-athlete story opt-outs (weekly, birthday, annual, birthday_feed_post). Missing key = on.';

NOTIFY pgrst, 'reload schema';
