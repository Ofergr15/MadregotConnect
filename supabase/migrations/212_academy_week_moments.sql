-- 212: the academy's weekly moments (academy doc p.2–3; design/b22/academy-week/mockup-v3.html, approved 24.11).
-- Four per coach per plan week: Saturday plan + focus + goals, Monday prep for Tuesday, Thursday prep for
-- Friday, Friday summary. A moment is written (a draft), then sent — now or at a time — by a person. NOTHING
-- sends on its own: a scheduled send only goes out because the coach pressed "send at".
-- Paste in the Supabase SQL editor. Idempotent. Locked like every table since 134: RLS on, no policies,
-- service role only through the API.

CREATE TABLE IF NOT EXISTS academy_week_moments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start    DATE NOT NULL,                           -- the PLAN week (Sunday) the moment belongs to
  kind          TEXT NOT NULL CHECK (kind IN ('plan', 'prep_tue', 'prep_fri', 'summary')),
  author_id     UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,   -- the coach; their trainees are the audience
  body          TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  goals         JSONB NOT NULL DEFAULT '[]'::jsonb,      -- Saturday only: [{ text }]
  notes         JSONB NOT NULL DEFAULT '{}'::jsonb,      -- per-trainee personal line: { athleteId: text }
  scheduled_at  TIMESTAMPTZ,                             -- "send at" — set only by the coach's press
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_start, kind, author_id)
);
CREATE INDEX IF NOT EXISTS academy_week_moments_due_idx ON academy_week_moments (scheduled_at) WHERE sent_at IS NULL AND scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS academy_week_moment_receipts (
  moment_id     UUID NOT NULL REFERENCES academy_week_moments(id) ON DELETE CASCADE,
  -- NO REFERENCES on purpose: moments already reference athletes (author_id), and a second FK here would make
  -- this a junction table — every unhinted athletes(...) embed from moments would then fail with "more than one
  -- relationship" (CLAUDE.md, migration 125; schemaEmbedAmbiguity.test.ts). Same choice as athlete_pr_exclusions.
  athlete_id    UUID NOT NULL,
  delivered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ,
  PRIMARY KEY (moment_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS academy_week_moment_receipts_athlete_idx ON academy_week_moment_receipts (athlete_id);

ALTER TABLE academy_week_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_week_moment_receipts ENABLE ROW LEVEL SECURITY;
