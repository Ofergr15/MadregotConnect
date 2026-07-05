-- Program weeks table: stores weekly training & nutrition plan PDFs
CREATE TABLE program_weeks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_number INTEGER NOT NULL,
  date_range TEXT NOT NULL,
  week_start_date DATE NOT NULL,
  training_pdf_url TEXT,
  nutrition_pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_start_date)
);

CREATE INDEX idx_program_weeks_start ON program_weeks(week_start_date DESC);

-- Seed existing weeks
INSERT INTO program_weeks (week_number, date_range, week_start_date, training_pdf_url, nutrition_pdf_url) VALUES
  (1, '31.05 – 06.06', '2026-05-31', '/plans/training-program/week-31-05-06-06-2026.pdf', '/plans/nutrition-plan/week-31-05-06-06-2026.pdf'),
  (2, '07.06 – 13.06', '2026-06-07', '/plans/training-program/week-07-13-06-2026.pdf', '/plans/nutrition-plan/week-07-13-06-2026.pdf'),
  (3, '14.06 – 20.06', '2026-06-14', '/plans/training-program/week-14-20-06-2026.pdf', '/plans/nutrition-plan/week-14-20-06-2026.pdf'),
  (4, '21.06 – 27.06', '2026-06-21', '/plans/training-program/week-21-27-06-2026.pdf', '/plans/nutrition-plan/week-21-27-06-2026.pdf'),
  (5, '28.06 – 04.07', '2026-06-28', '/plans/training-program/week-28-06-04-07-2026.pdf', '/plans/nutrition-plan/week-28-06-04-07-2026.pdf');
