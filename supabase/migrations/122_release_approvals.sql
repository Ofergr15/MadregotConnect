CREATE TABLE IF NOT EXISTS release_approvals (id bigserial PRIMARY KEY, sha text NOT NULL, note_ids text[] NOT NULL DEFAULT '{}', approved_at timestamptz NOT NULL DEFAULT now(), approved_by uuid, shipped_at timestamptz);
ALTER TABLE release_approvals ENABLE ROW LEVEL SECURITY;
