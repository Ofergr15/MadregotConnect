-- Results approval workflow + academy_user role + academy settings.

-- 1) Benchmark results approval. status 'approved' by default (coach-entered and
--    imported results are trusted); athlete self-submissions that would rank top-3
--    are held 'pending' until an admin approves.
ALTER TABLE benchmark_results ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE benchmark_results ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE benchmark_results ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_benchmark_results_status ON benchmark_results(coach_id, test_name, status);

-- 2) academy_user role — a club member who uses the academy with controlled access.
--    Reuses the existing role_tab_permissions nav-gating system.
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'dashboard', true),
  ('academy_user', 'academy', false),   -- can't see the coach academy admin by default
  ('academy_user', 'activities', true),
  ('academy_user', 'races', true),
  ('academy_user', 'program', true),
  ('academy_user', 'practice', true),
  ('academy_user', 'history', false),
  ('academy_user', 'plan/new', false),
  ('academy_user', 'athletes', false),
  ('academy_user', 'groups', false),
  ('academy_user', 'settings', false)
ON CONFLICT (role, tab) DO NOTHING;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('academy_user', 'dashboard', true),
  ('academy_user', 'activities', true),
  ('academy_user', 'races', true),
  ('academy_user', 'program', true),
  ('academy_user', 'practice', true)
ON CONFLICT (role, tab) DO NOTHING;

-- 3) Academy settings — one JSON row per coach holding: tests[], adherence
--    tolerances, pace-alert toggle, weekly-report recipients/day.
CREATE TABLE IF NOT EXISTS academy_settings (
  coach_id UUID PRIMARY KEY REFERENCES coaches(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
