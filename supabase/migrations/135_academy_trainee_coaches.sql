-- Academy: a trainee can have several coaches.
--
-- Until now the pair lived in one column, athletes.academy_coach_id, so a trainee
-- had exactly one coach. The academy now shares some trainees between coaches, and
-- every coach of a trainee is equal: each sees everything, writes in the one shared
-- conversation, gives feedback and sends plans. Only the manager changes the set.
--
-- athletes.academy_coach_id stays, as the LEGACY "first coach". The app keeps
-- writing it (the first coach of the set, or NULL) so code that ships before this
-- migration is pasted, and anything still reading the column, keeps working.
-- The set itself lives here.
--
-- academy_coach_history is unchanged: its "one open row per trainee" index stays,
-- and the history keeps following the first coach.

CREATE TABLE IF NOT EXISTS academy_trainee_coaches (
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  since DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (athlete_id, coach_id)
);

-- "Which trainees does this coach hold" is the hot read (every coach-scoped route).
CREATE INDEX IF NOT EXISTS idx_academy_trainee_coaches_coach
  ON academy_trainee_coaches(coach_id);

-- Every existing pair becomes a one-coach set. Safe to re-run.
INSERT INTO academy_trainee_coaches (athlete_id, coach_id)
SELECT id, academy_coach_id FROM athletes WHERE academy_coach_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Same lock-down as 134: RLS on, nothing for anon/authenticated, the server's
-- service role only.
ALTER TABLE academy_trainee_coaches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE academy_trainee_coaches FROM anon, authenticated;
GRANT ALL ON TABLE academy_trainee_coaches TO service_role;
