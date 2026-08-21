-- Phase 3 of the "missing parts" roadmap — Achievements & Badges (#11), the
-- shared reward primitive that Phase 4's Challenge System will also build on
-- (a completed challenge is just an insert into athlete_badges, inheriting
-- the feed post + push for free — see the roadmap doc's Phase 3/4 design).
--
-- `badges` is a small catalog, not a schema-per-badge table: adding a new
-- badge of an ALREADY-SUPPORTED rule_type is a plain INSERT, no migration, no
-- deploy — only a genuinely new rule_type needs a code change (the app's own
-- award-evaluation code is the thing that understands each rule_type).
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,           -- stable machine key, e.g. 'first_5k'
  name_he TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_he TEXT,
  description_en TEXT,
  icon TEXT NOT NULL DEFAULT '🏅',      -- emoji fallback, always set
  -- Real uploaded artwork, admin-chosen. When set, the UI should prefer this
  -- over `icon` (emoji stays as a fallback for badges nobody's illustrated).
  icon_url TEXT,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'pr_bucket', 'cumulative_distance', 'cumulative_duration', 'streak_weeks',
    'race_count', 'attendance_perfect_month', 'challenge_completed'
  )),
  rule_params JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Who created it: NULL for the 11 seeded v1 badges, an athletes.id for
  -- anything an admin creates later via the new admin UI.
  created_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per award. `context` carries whatever evidence justified the award
-- (e.g. the qualifying activity id, the streak length reached) for display/
-- audit — never re-derived after the fact, since underlying data can change.
CREATE TABLE IF NOT EXISTS athlete_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context JSONB NOT NULL DEFAULT '{}'::JSONB,
  UNIQUE (athlete_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_badges_athlete
  ON athlete_badges (athlete_id, awarded_at DESC);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages badges" ON badges;
CREATE POLICY "Service role manages badges"
  ON badges FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages athlete badges" ON athlete_badges;
CREATE POLICY "Service role manages athlete badges"
  ON athlete_badges FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─── Storage for admin-uploaded badge artwork ───────────────────────────────
-- Same recipe as the existing `avatars`/`feed-media` buckets: public read,
-- writes go only through the service-role admin API route.

INSERT INTO storage.buckets (id, name, public)
VALUES ('badge-icons', 'badge-icons', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access for badge icons') THEN
    CREATE POLICY "Public read access for badge icons"
      ON storage.objects FOR SELECT USING (bucket_id = 'badge-icons');
  END IF;
END $$;

-- ─── Seed catalog (product decision, v1 — 11 badges) ────────────────────────
-- Icons are emoji placeholders (product decision: illustrated art is a
-- separate, later asset task, not this migration's concern).

INSERT INTO badges (code, name_he, name_en, description_he, description_en, icon, rule_type, rule_params) VALUES
  ('first_5k',  'ריצה ראשונה 5 ק"מ',  'First 5K',            'השלמת ריצת 5 ק"מ הראשונה שלך',      'Completed your first 5K run',            '🏃', 'pr_bucket', '{"bucket":"5k"}'),
  ('first_10k', 'ריצה ראשונה 10 ק"מ', 'First 10K',           'השלמת ריצת 10 ק"מ הראשונה שלך',     'Completed your first 10K run',           '🏃', 'pr_bucket', '{"bucket":"10k"}'),
  ('first_hm',  'חצי מרתון ראשון',    'First Half Marathon', 'השלמת חצי המרתון הראשון שלך',        'Completed your first half marathon',     '🥈', 'pr_bucket', '{"bucket":"hm"}'),
  ('first_fm',  'מרתון ראשון',        'First Marathon',      'השלמת המרתון הראשון שלך',            'Completed your first marathon',          '🥇', 'pr_bucket', '{"bucket":"fm"}'),
  ('vol_100km',  '100 ק"מ',  '100km Total',  'צברת 100 ק"מ מצטברים',  'Reached 100km total distance',  '📏', 'cumulative_distance', '{"km":100}'),
  ('vol_500km',  '500 ק"מ',  '500km Total',  'צברת 500 ק"מ מצטברים',  'Reached 500km total distance',  '📏', 'cumulative_distance', '{"km":500}'),
  ('vol_1000km', '1000 ק"מ', '1000km Total', 'צברת 1000 ק"מ מצטברים', 'Reached 1000km total distance', '📏', 'cumulative_distance', '{"km":1000}'),
  ('streak_4w',  'רצף חודש',       '4-Week Streak',  'רצת לפחות פעם אחת ב-4 שבועות רצופים',  'Ran at least once for 4 consecutive weeks',  '🔥', 'streak_weeks', '{"weeks":4}'),
  ('streak_12w', 'רצף 3 חודשים',   '12-Week Streak', 'רצת לפחות פעם אחת ב-12 שבועות רצופים', 'Ran at least once for 12 consecutive weeks', '🔥', 'streak_weeks', '{"weeks":12}'),
  ('first_race', 'מרוץ ראשון', 'First Race', 'השתתפת במרוץ הרשמי הראשון שלך', 'Completed your first official race', '🏁', 'race_count', '{"count":1}'),
  ('perfect_month_attendance', 'נוכחות מושלמת', 'Perfect Attendance', 'הגעת לכל אימוני הקבוצה בחודש קלנדרי', 'Attended every team practice in a calendar month', '✅', 'attendance_perfect_month', '{}')
ON CONFLICT (code) DO NOTHING;
