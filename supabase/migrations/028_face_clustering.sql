-- Cluster detected faces of the same person together.
-- person_name allows tagging non-registered people by name only.
ALTER TABLE detected_faces ADD COLUMN IF NOT EXISTS cluster_id UUID;
ALTER TABLE detected_faces ADD COLUMN IF NOT EXISTS person_name TEXT;
CREATE INDEX IF NOT EXISTS idx_detected_faces_cluster_id ON detected_faces(cluster_id);
