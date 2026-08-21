-- Photos + face recognition (revised design)
-- Drops the old photo_tags approach and athletes.rekognition_face_id.
-- detected_faces IS the tag table. athlete_faces holds enrolled references.

-- Photos imported from Google Drive, grouped by run date.
-- Full images stay in Drive; only cropped faces are stored in Supabase.
CREATE TABLE IF NOT EXISTS run_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES coaches(id),
  drive_file_id TEXT NOT NULL UNIQUE,
  drive_url TEXT NOT NULL,
  thumbnail_url TEXT,
  filename TEXT,
  taken_at TIMESTAMPTZ,         -- from Drive metadata (createdTime)
  run_date DATE NOT NULL,       -- coach-confirmed date this photo belongs to
  width INTEGER,
  height INTEGER,
  faces_detected INTEGER,       -- NULL = not yet processed
  processed_at TIMESTAMPTZ,     -- NULL = not yet processed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One row per face detected in a photo. athlete_id NULL = unidentified.
-- This IS the tagging record; there is no separate photo_tags table.
CREATE TABLE IF NOT EXISTS detected_faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES run_photos(id) ON DELETE CASCADE,
  bounding_box JSONB,           -- {left, top, width, height} 0-1 relative
  crop_url TEXT,                -- public face-crops bucket URL
  rekognition_face_id TEXT,     -- always set: indexed for similarity search
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  confidence NUMERIC,           -- similarity 0-100; NULL = manual tag
  source TEXT DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reference faces enrolled in the Rekognition collection.
-- origin='selfie': athlete uploaded a selfie.
-- origin='coach_label': coach labeled an unidentified crop from a run photo.
CREATE TABLE IF NOT EXISTS athlete_faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  rekognition_face_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('selfie', 'coach_label')),
  source_face_id UUID REFERENCES detected_faces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_photos_run_date         ON run_photos(run_date);
CREATE INDEX IF NOT EXISTS idx_run_photos_unprocessed      ON run_photos(id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_detected_faces_photo_id     ON detected_faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_detected_faces_athlete_id   ON detected_faces(athlete_id);
CREATE INDEX IF NOT EXISTS idx_detected_faces_unidentified ON detected_faces(id) WHERE athlete_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_athlete_faces_athlete_id    ON athlete_faces(athlete_id);

-- Storage buckets
INSERT INTO storage.buckets (id, name, public)
VALUES ('face-crops', 'face-crops', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('reference-faces', 'reference-faces', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "face-crops: public read"
    ON storage.objects FOR SELECT USING (bucket_id = 'face-crops');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "face-crops: service write"
    ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'face-crops');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "face-crops: service delete"
    ON storage.objects FOR DELETE USING (bucket_id = 'face-crops');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "reference-faces: service all"
    ON storage.objects FOR ALL USING (bucket_id = 'reference-faces');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tab permissions for photos tab
INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin',         'photos', true),
  ('coach',         'photos', true),
  ('academy_coach', 'photos', true),
  ('core_runner',   'photos', true),
  ('runner',        'photos', true),
  ('academy_user',  'photos', true),
  ('viewer',        'photos', false)
ON CONFLICT (role, tab) DO NOTHING;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin',         'photos', true),
  ('coach',         'photos', true),
  ('academy_coach', 'photos', true),
  ('runner',        'photos', true),
  ('core_runner',   'photos', true),
  ('academy_user',  'photos', true),
  ('viewer',        'photos', false)
ON CONFLICT (role, tab) DO NOTHING;
