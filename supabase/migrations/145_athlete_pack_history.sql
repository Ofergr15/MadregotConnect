-- Which pace pack a member was in, from which day (plan: ~/.cache/madregot/pack-change).
--
-- Before this, every reader asked athletes.group_id — the pack TODAY — so a member
-- moved from ❸ to ❷ had every run they ever did re-scored against ❷'s paces: last
-- Sunday's 4:35 became "too slow", and so did last month's. lib/groups/pack-history.ts
-- answers "which pack on this date" from these rows, falling back to group_id.
--
-- No seed. The first change writes the member's previous pack from 2000-01-01 before
-- the new one (recordPackChange), so a member who never moved has no rows and reads
-- group_id exactly as before.
--
-- group_id has NO foreign key on purpose: a table with keys to both athletes and
-- groups is a junction PostgREST would offer as a second athletes↔groups path, and
-- every unhinted groups( embed would fail (schemaEmbedAmbiguity.test.ts).
--
-- OPTIONAL until pasted: reads treat a missing table as "no history", writes skip.

CREATE TABLE IF NOT EXISTS athlete_pack_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  group_id UUID,
  from_date DATE NOT NULL,
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_pack_history_athlete_from ON athlete_pack_history (athlete_id, from_date);
ALTER TABLE athlete_pack_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE athlete_pack_history FROM anon, authenticated;
GRANT ALL ON TABLE athlete_pack_history TO service_role;
