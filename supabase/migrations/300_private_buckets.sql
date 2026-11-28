-- 300_private_buckets.sql — owner rule 2026-11-28: no bucket is public without a reason.
-- NOT applied. Paste by hand in the Supabase SQL editor, AFTER the deploy that ships
-- /api/files (lib/storage/buckets.ts) is live in production. Idempotent.
--
-- A public bucket is served with no RLS at all: anyone with a URL reads the file and the
-- anon key (shipped in the web bundle) lists every object — migration 223 dropping the
-- SELECT policies did not change that. After this, these eight are read only through
-- GET /api/files/<bucket>/<path> (verified member → 302 to a 10-minute signed URL); rows
-- keep their old public links and the server rewrites them on read, so no data moves.
--
-- Stays public, with its reason in lib/storage/buckets.ts: notification-images (push
-- banner fetched by the browser/OS without a session).
--
-- Rollback (restores the old behaviour exactly; the app keeps working either way):
--   UPDATE storage.buckets SET public = true
--    WHERE id IN ('avatars','badge-icons','event-images','feed-media',
--                 'perk-images','program-plans','run-chat','store-products');

UPDATE storage.buckets
   SET public = false
 WHERE id IN ('avatars', 'badge-icons', 'event-images', 'feed-media',
              'perk-images', 'program-plans', 'run-chat', 'store-products')
   AND public IS DISTINCT FROM false;

-- VERIFY (expect exactly one row: notification-images | true):
--   SELECT id, public FROM storage.buckets WHERE public ORDER BY id;
-- And with the ANON key (expect [] or an error — no file names):
--   curl -s -X POST "$SUPABASE_URL/storage/v1/object/list/avatars" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{"prefix":""}'
