-- Stories gate, phase 1 (design: madregot-stories-admin-design.md, Ofer 2026-10-19).
-- One server-side gate per story feature, fail closed: a missing row, a read error or
-- app_settings.stories_paused='on' means NOBODY sees it. Phase 1 wires ONLY 'weekly';
-- the birthday paths still run on app_settings.birthday_year_send and do not read this
-- table yet, so the 'off' seed for birthday/annual changes nothing live.
-- States: off | self (admin/super-user preview only, no push) | testers (story_testers) | all.
-- Idempotent: safe to paste twice. RLS on, no policies = service role only (reads go through the API).
CREATE TABLE IF NOT EXISTS story_feature_settings (
  feature      TEXT PRIMARY KEY CHECK (feature IN ('weekly','birthday','annual')),
  state        TEXT NOT NULL DEFAULT 'off' CHECK (state IN ('off','self','testers','all')),
  send_push    BOOLEAN NOT NULL DEFAULT true,
  feed_post    BOOLEAN NOT NULL DEFAULT false,
  generate_at  TIME NOT NULL DEFAULT '07:00',
  weekday      SMALLINT CHECK (weekday BETWEEN 0 AND 6),
  annual_date  TEXT CHECK (annual_date ~ '^\d{2}-\d{2}$'),
  display_days SMALLINT NOT NULL DEFAULT 7 CHECK (display_days BETWEEN 1 AND 31),
  min_runs     SMALLINT NOT NULL DEFAULT 1,
  updated_by   UUID REFERENCES athletes(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO story_feature_settings (feature, state, generate_at, weekday, annual_date, display_days, min_runs, feed_post) VALUES
  ('weekly',   'testers', '18:00', 6,    NULL,    2,  1,  false),
  ('birthday', 'off',     '07:00', NULL, NULL,    7,  10, false),
  ('annual',   'off',     '18:00', NULL, '12-31', 31, 10, false)
ON CONFLICT (feature) DO NOTHING;

CREATE TABLE IF NOT EXISTS story_testers (
  athlete_id  UUID PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
  added_by    UUID,               -- who added them (no FK: one athlete FK per table keeps PostgREST embeds unambiguous)
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_at  TIMESTAMPTZ
);

ALTER TABLE story_feature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_testers ENABLE ROW LEVEL SECURITY;

-- Kill switch for every story ("השהה הכל"). 'on' = paused. Missing = not paused.
INSERT INTO app_settings (key, value) VALUES ('stories_paused', 'off')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
