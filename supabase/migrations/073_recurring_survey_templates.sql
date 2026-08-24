-- Recurring pace-group poll templates, one row per team day, independently
-- editable via the admin UI — previously hardcoded identically in
-- cron/tick.ts, which meant any change required a code edit + deploy and
-- Tuesday/Friday could never actually differ.
CREATE TABLE IF NOT EXISTS recurring_survey_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  day_of_week INT NOT NULL UNIQUE,  -- 0=Sun..6=Sat (JS getDay() convention)
  question_he TEXT NOT NULL,
  question_en TEXT,
  options_he TEXT[] NOT NULL,
  options_en TEXT[],
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Tuesday (2) and Friday (5) with today's current content.
INSERT INTO recurring_survey_templates (day_of_week, question_he, question_en, options_he, options_en) VALUES
  (2, 'מי בא לרוץ מחר בבוקר (5:00)? 🌅🏃 בחרו דבוקה!', 'Who''s running tomorrow morning (5:00am)? 🌅🏃 Pick your pace group!',
   ARRAY['דבוקה 1', 'דבוקה 2', 'דבוקה 3', 'לא מגיע/ה הפעם'], ARRAY['Group 1', 'Group 2', 'Group 3', 'Not coming this time']),
  (5, 'מי בא לרוץ מחר בבוקר (5:00)? 🌅🏃 בחרו דבוקה!', 'Who''s running tomorrow morning (5:00am)? 🌅🏃 Pick your pace group!',
   ARRAY['דבוקה 1', 'דבוקה 2', 'דבוקה 3', 'לא מגיע/ה הפעם'], ARRAY['Group 1', 'Group 2', 'Group 3', 'Not coming this time'])
ON CONFLICT (day_of_week) DO NOTHING;
