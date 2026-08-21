-- Track which Drive folder each photo came from so we can show import status per folder.
ALTER TABLE run_photos ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
CREATE INDEX IF NOT EXISTS idx_run_photos_drive_folder_id ON run_photos(drive_folder_id);
