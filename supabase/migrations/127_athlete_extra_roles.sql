ALTER TABLE athletes ADD COLUMN IF NOT EXISTS extra_roles text[] NOT NULL DEFAULT '{}';
ALTER TABLE athletes DROP CONSTRAINT IF EXISTS athletes_extra_roles_valid;
ALTER TABLE athletes ADD CONSTRAINT athletes_extra_roles_valid CHECK (extra_roles <@ ARRAY['coach','academy_coach','academy_manager','admin']::text[]);
