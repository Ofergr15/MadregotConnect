-- 347_group_chat_media_bucket.sql — task 182 (group chat photo messages). Idempotent.
--
-- PRIVATE bucket: no public read policy. Objects are written and read only by the service role,
-- and members get short-lived signed links from GET /api/group-chat/photos after the membership
-- check. Layout: <groupId>/<photoId>@{thumb,medium,full}.webp (re-encoded, no EXIF; the camera
-- original is never stored).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('group-chat-media', 'group-chat-media', false, 12582912, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false;
