-- The academy coach tools (mockup academy-coach-tools.html): what a coach DECIDED.
--
-- One row per decision, kept as history:
--   kind 'pace'    action apply | half | snooze. `changes` is the sec/km per kind this
--                  decision added ({"reps": -7, "tempo": -6}); `week_start` is the plan
--                  week it applies from; `basis_test_date` is the test it was measured
--                  against. The update in force = the apply/half rows on the CURRENT test,
--                  summed, so a new test resets it (and every snooze) with no write.
--   kind 'missed'  action light | planned | repeat | talk, `week_start` = the missed week.
--   kind 'copy'    reserved for a copy-week log.
-- `evidence` is the structured "why" the trainee's card prints (sessions, counts, paces).
--
-- OPTIONAL. Without it the suggestions still show and an update still re-resolves the
-- planned weeks; there is no record, no trainee card, and snoozes live on the device.
--
-- Two FKs to athletes (trainee, coach): embed the coach as `athletes!coach_id(name)`.
--
-- Locked like every table since 134: RLS on, nothing for anon/authenticated, service role
-- only through the API.

CREATE TABLE IF NOT EXISTS academy_coach_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  coach_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pace', 'missed', 'copy')),
  action TEXT NOT NULL,
  basis_test_date DATE,
  week_start DATE,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_coach_decisions_athlete
  ON academy_coach_decisions(athlete_id, created_at);
ALTER TABLE academy_coach_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE academy_coach_decisions FROM anon, authenticated;
GRANT ALL ON TABLE academy_coach_decisions TO service_role;
