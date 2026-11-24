-- 215: pack leaders + pack moments (b23 academy contract, flags academy_pack_leader).
-- A "pack" is a row of `groups` (pace pack ❶❷❸). A leader is a member who runs the pack's
-- session on the ground: sees who read the plan, marks attendance, sends the pack's moments.
-- A leader is NOT staff and never sees verdicts, HR or pain (CLAUDE.md, 2026-11-24).
--
-- pack_id carries NO foreign key on purpose: a table with keys to both athletes and groups is
-- a junction PostgREST would offer as a second athletes<->groups path, and every unhinted
-- groups( embed would fail (schemaEmbedAmbiguity.test.ts, migration 145's same choice).
-- Paste in the Supabase SQL editor. Idempotent. RLS on, no policies: service role only.

CREATE TABLE IF NOT EXISTS pack_leaders (
  pack_id     UUID NOT NULL,
  athlete_id  UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS pack_leaders_athlete_idx ON pack_leaders (athlete_id);

CREATE TABLE IF NOT EXISTS pack_moments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id     UUID NOT NULL,                      -- no FK, see above
  kind        TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('plan', 'reminder', 'meetup', 'summary', 'note')),
  body        TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  send_at     TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  sent_by     UUID,                               -- no FK: the author is not an embed anyone needs
  ready_by    TIMESTAMPTZ,                        -- when the draft must be ready (shown to the leader)
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pack_moments_pack_idx ON pack_moments (pack_id, send_at);

ALTER TABLE pack_leaders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_moments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pack_leaders FROM anon, authenticated;
REVOKE ALL ON TABLE pack_moments FROM anon, authenticated;
GRANT ALL ON TABLE pack_leaders TO service_role;
GRANT ALL ON TABLE pack_moments TO service_role;
