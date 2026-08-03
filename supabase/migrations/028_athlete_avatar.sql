-- Profile photo (PRD §7). Sourced from the athlete's Google account at login
-- (user_metadata.avatar_url) and optionally overridden by a manual upload.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Storage bucket for manually-uploaded profile photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access for avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Service role upload for avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Service role update for avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');
