-- 208: the leads screen's server side (GET /api/admin/leads, POST /api/admin/leads/touch).
--
-- Idempotent; paste in the Supabase SQL editor like every other migration.
--
-- EMBED HINTING: this adds a SECOND foreign key from signup_requests to athletes
-- (athlete_id already is one). From the moment it is pasted, an unhinted
-- `signup_requests.select('athletes(…)')` (or the reverse) fails with "more than one
-- relationship was found" — how 125 took the feed down. Checked when this was
-- written: nothing in src embeds across the pair, so there is nothing to hint. Any
-- future embed MUST say `athletes!athlete_id(…)` or `athletes!decided_by_id(…)`.
-- The pair is listed in KNOWN_AMBIGUOUS in src/__tests__/schemaEmbedAmbiguity.test.ts.

-- Who decided a request, as an athlete row (approved_by/rejected_by are bare emails).
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS decided_by_id uuid REFERENCES athletes(id) ON DELETE SET NULL;
-- Staff-only. The approver's reason; never returned to the applicant.
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS decision_note text;

-- A call, a message or a note a staff member logged against a lead.
--
-- `lead_ref` is '<source>:<id>' (signup:<uuid>, academy:<uuid>, u21:<uuid>) and is
-- deliberately NOT a foreign key: a lead spans three tables, and the log must outlive
-- the row it talks about (a declined U21 applicant may be deleted on request).
CREATE TABLE IF NOT EXISTS lead_touches (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_ref  text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('call', 'message', 'note')),
  by_id     uuid REFERENCES athletes(id) ON DELETE SET NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  note      text
);

CREATE INDEX IF NOT EXISTS lead_touches_ref_idx ON lead_touches (lead_ref, at DESC);

ALTER TABLE lead_touches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lead_touches FROM anon, authenticated;

COMMENT ON TABLE lead_touches IS
  'Staff contact log for the leads screen (migration 208). Service-role only: RLS on, no policies.';
