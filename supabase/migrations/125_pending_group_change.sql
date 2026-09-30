ALTER TABLE athletes ADD COLUMN IF NOT EXISTS pending_group_id uuid REFERENCES groups(id) ON DELETE SET NULL;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS pending_group_from date;
