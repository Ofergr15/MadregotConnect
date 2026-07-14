-- Academy feature foundation
-- 1) Mark a separate class of "academy" athletes (higher-touch coaching).
--    An academy athlete can still belong to a normal pace-group.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS is_academy BOOLEAN NOT NULL DEFAULT false;

-- 2) Per-athlete individual plans for academy athletes.
--    NULL = existing group-wide plan (unchanged). Set = an individual plan
--    targeted at a single academy athlete.
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_weekly_plans_athlete_id ON weekly_plans(athlete_id);

-- 3) Academy is a coach/admin management surface. Seed tab permissions
--    (web + mobile) following the ON CONFLICT pattern of earlier migrations.
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'academy', true),
  ('coach', 'academy', true),
  ('core_runner', 'academy', false),
  ('runner', 'academy', false),
  ('viewer', 'academy', false)
ON CONFLICT (role, tab) DO NOTHING;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'academy', true),
  ('coach', 'academy', true)
ON CONFLICT (role, tab) DO NOTHING;
