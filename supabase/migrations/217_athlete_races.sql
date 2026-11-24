-- 217: an athlete's own races (flag athlete_races) and a coach's race plan for one (flag
-- academy_race_plan). Self-or-own-coach; see CLAUDE.md "Recorded exposure change, 2026-11-24".
--
-- athlete_races has ONE key to athletes (athlete_id); created_by carries none. race_plans keys
-- only athlete_races; author_id carries none — so no table pair gains a second relationship
-- (schemaEmbedAmbiguity.test.ts). Paste by hand. Idempotent.

CREATE TABLE IF NOT EXISTS athlete_races (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  race_date     DATE NOT NULL,
  distance_m    INTEGER NOT NULL CHECK (distance_m > 0 AND distance_m <= 1000000),
  goal_sec      INTEGER CHECK (goal_sec IS NULL OR goal_sec > 0),
  created_by    UUID,
  coach_seen_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_races_athlete_idx ON athlete_races (athlete_id, race_date);

CREATE TABLE IF NOT EXISTS race_plans (
  race_id     UUID PRIMARY KEY REFERENCES athlete_races(id) ON DELETE CASCADE,
  goal_sec    INTEGER CHECK (goal_sec IS NULL OR goal_sec > 0),
  segments    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ toM, paceSec }]
  fuel        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ atM, kind: gel|water }]
  note        TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 4000),
  author_id   UUID,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE athlete_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE athlete_races FROM anon, authenticated;
REVOKE ALL ON TABLE race_plans FROM anon, authenticated;
GRANT ALL ON TABLE athlete_races TO service_role;
GRANT ALL ON TABLE race_plans TO service_role;
