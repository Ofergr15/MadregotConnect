-- Races table to store upcoming races
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  location TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  distances TEXT[] NOT NULL DEFAULT '{}',
  type TEXT NOT NULL DEFAULT 'half',
  website TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with races from training program PDFs
INSERT INTO races (name, date, location, lat, lng, distances, type, website) VALUES
  ('5 ק"מ הרצליה', '2026-09-03', 'הרצליה', 32.1628, 34.7896, ARRAY['5km'], '5k', NULL),
  ('מרוץ פארק הירקון', '2026-10-09', 'תל אביב, פארק הירקון', 32.0971, 34.8072, ARRAY['21.1km', '10km'], 'half', NULL),
  ('חצי שמק החולה', '2026-10-30', 'עמק החולה', 33.0667, 35.6000, ARRAY['21.1km', '10km'], 'half', NULL),
  ('מרוץ אייל', '2026-11-14', 'אייל', 32.1667, 34.9500, ARRAY['21.1km', '10km'], 'half', NULL),
  ('מרתון ולנסיה ''26', '2026-12-06', 'Valencia, Spain', 39.4699, -0.3763, ARRAY['42.2km', '21.1km', '10km'], 'marathon', 'https://www.valenciaciudaddelrunning.com');
