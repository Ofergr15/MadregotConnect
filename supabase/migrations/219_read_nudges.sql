-- 219: "hasn't read" nudges (b24 UNR, flag academy_read_nudge).
-- One row per (person, Israel day): the PRIMARY KEY is the rate limit. An INSERT ... ON CONFLICT DO NOTHING
-- that returns no row means this person was already nudged today, by anyone, from any screen — so two
-- coaches pressing at once, or a coach and the pack leader, still send one push.
--
-- No foreign keys on purpose: athlete_id / nudged_by both point at athletes, and two keys to one table plus
-- any later key elsewhere is the "more than one relationship" trap (CLAUDE.md, migration 125). Nothing
-- embeds this table; it is written and read only by POST /api/academy/read-nudge.
-- Paste in the Supabase SQL editor. Idempotent. RLS on, no policies: service role only.

CREATE TABLE IF NOT EXISTS read_nudges (
  athlete_id  UUID NOT NULL,
  nudged_on   DATE NOT NULL,                 -- Israel calendar day
  nudged_by   UUID,
  context     TEXT NOT NULL CHECK (context IN ('moment', 'pack')),
  context_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, nudged_on)
);

ALTER TABLE read_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE read_nudges FROM anon, authenticated;
GRANT ALL ON TABLE read_nudges TO service_role;
