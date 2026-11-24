-- 214: manual photo tags on Drive v2 photos ("התמונות שלי"). No face recognition: a person is tagged
-- by hand, by a club member or by themselves. A tag of someone else stays 'pending' until the tagged
-- person approves it; the tagged person can remove any tag of them at any time.
--
-- photo_id is the Drive file id of a photo inside a subfolder of the session-photos source folder
-- (Madregot_After_2KM, SESSION_PHOTOS_DRIVE_FOLDER_ID); folder_id is that subfolder (the album).
-- Not linked to run_photos / detected_faces (044-046), which stay off.
--
-- Read and written only through /api/photos/tags* (service role, verified member JWT). RLS is on with
-- no policies, so the anon key reads nothing. Idempotent; safe to paste twice.

CREATE TABLE IF NOT EXISTS photo_tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id     TEXT NOT NULL,
  folder_id    TEXT NOT NULL,
  athlete_id   UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- No FK on purpose: a second REFERENCES athletes makes every unhinted photo_tags↔athletes embed ambiguous
  -- (schemaEmbedAmbiguity.test.ts). It is only ever compared to the caller's id.
  tagged_by    UUID,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ,
  UNIQUE (photo_id, athlete_id)
);

CREATE INDEX IF NOT EXISTS idx_photo_tags_athlete ON photo_tags (athlete_id, status);
CREATE INDEX IF NOT EXISTS idx_photo_tags_folder ON photo_tags (folder_id);

ALTER TABLE photo_tags ENABLE ROW LEVEL SECURITY;
