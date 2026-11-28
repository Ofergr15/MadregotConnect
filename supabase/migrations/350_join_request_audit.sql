-- 350: an audit row per join-request decision (task 186).
--
-- POST /api/admin/join-requests/{id}/decision writes one row after the decision is
-- committed (approve via /api/admin/registrations/approve, or reject): who decided, what,
-- the reason they gave, the group they set and the group the applicant's best time
-- suggested — so "why is X in pack 2" and "who turned Y down" have an answer.
-- Staff-only data: the reason is never mailed or shown to the applicant.
--
-- No FK to athletes or groups on purpose (schemaEmbedAmbiguity.test.ts; an audit row
-- outlives a deleted group). Paste by hand. Idempotent.

CREATE TABLE IF NOT EXISTS join_request_audit (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID NOT NULL,
  action             TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
  reason             TEXT CHECK (reason IS NULL OR char_length(reason) <= 280),
  group_id           UUID,
  suggested_group_id UUID,
  suggestion_kind    TEXT CHECK (suggestion_kind IS NULL OR suggestion_kind IN ('group', 'academy', 'none')),
  group_source       TEXT CHECK (group_source IS NULL OR group_source IN ('approver', 'suggestion', 'request')),
  actor_email        TEXT,
  actor_athlete_id   UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS join_request_audit_request_idx ON join_request_audit (request_id, created_at DESC);

ALTER TABLE join_request_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE join_request_audit FROM anon, authenticated;
GRANT ALL ON TABLE join_request_audit TO service_role;
