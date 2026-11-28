-- 226 — Access groups: owner-made groups of people with a screen set each.
-- Design: review-2026-11-20/access-groups-design.md. Paste by hand in the Supabase SQL editor.
-- Idempotent. Service-role only (RLS on, no policies), like every table here.

CREATE TABLE IF NOT EXISTS access_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  color       TEXT NOT NULL DEFAULT '#1C1C1E' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS access_groups_name_uidx ON access_groups (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS access_group_members (
  group_id    UUID NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  athlete_id  UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  added_by    TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS access_group_members_athlete_idx ON access_group_members (athlete_id);

-- Append-only. Screen changes are audited in feature_enablement_audit (scope_type 'access_group').
CREATE TABLE IF NOT EXISTS access_group_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete','member_add','member_remove')),
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor       TEXT NOT NULL,
  actor_name  TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_group_audit_idx ON access_group_audit (group_id, at DESC);

ALTER TABLE access_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_group_audit   ENABLE ROW LEVEL SECURITY;

-- feature_enablements gains the 'access_group' scope (scope_id = access_groups.id).
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'feature_enablements'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%scope_type%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE feature_enablements DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE feature_enablements ADD CONSTRAINT feature_enablements_scope_type_check
  CHECK (scope_type IN ('athlete','access_group','squad','academy','role','club'));
