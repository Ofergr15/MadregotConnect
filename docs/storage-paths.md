# Storage paths vs migration 223 (no anon SELECT)

Task 80. Migration `223_storage_no_anon_listing.sql` drops the "public read" SELECT
policies on `storage.objects`. This lists **every** upload / upsert / list / download
path in the app and why each keeps working. Pinned by `src/__tests__/storageServerOnly.test.ts`:
no client (`'use client'`) file may touch `.storage`, so a new anon-key storage call can't
slip in unnoticed.

**Rule that makes 223 safe:** every storage call runs server-side on the service-role
client (`createServerClient()` in `src/lib/supabase/server.ts`, or a `SupabaseClient`
passed in from a route/cron that built one). The service role bypasses RLS, so neither
`upsert: true` (which needs SELECT+UPDATE for an RLS-bound role) nor `.list()` depends on
the dropped policies. Reads by URL use `getPublicUrl()` on **public** buckets, which are
served without any SELECT policy; private buckets use `createSignedUrl()` (service role).

| path | bucket | ops | runs as |
|---|---|---|---|
| `api/athletes/avatar` | avatars | upload (upsert), getPublicUrl | service role |
| `api/plans/[planId]/clipboards` | program-plans | upload (upsert), getPublicUrl | service role |
| `api/program-weeks` | program-plans | upload (upsert), getPublicUrl | service role |
| `api/run-chat` | run-chat | list, remove | service role |
| `lib/run-chat/seed-chat.ts`, `lib/run-chat/run-artifacts.ts` | run-chat | getBucket/createBucket, upload (upsert), getPublicUrl | service role (passed in) |
| `api/admin/birthdays/photo` | feed-media | upload, getPublicUrl | service role |
| `api/feed/media`, `api/feed/posts`, `api/feed/items/[id]` | feed-media | upload, getPublicUrl | service role |
| `api/quality-session/photos`, `lib/quality-session/album-fetch.ts` | feed-media | upload, getPublicUrl | service role |
| `api/admin/badges/icon` | badge-icons | upload, getPublicUrl | service role |
| `api/admin/notifications/image` | notification-images | upload, getPublicUrl | service role |
| `api/admin/perks/image` | perk-images | upload, getPublicUrl | service role |
| `api/admin/store/products/image` | store-products | upload, getPublicUrl | service role |
| `api/events/images` | event-images | upload, getPublicUrl | service role |
| `api/photos/process` | face-crops | upload (upsert), getPublicUrl | service role |
| `api/photos/enroll-selfie`, `api/photos/selfie-url` | reference-faces (private) | upload (upsert), remove, list, createSignedUrl | service role |
| `api/activities/gpx`, `lib/strava/gpx-store.ts`, `lib/strava/enrich.ts` | run-gpx (private) | upload (upsert), download, createSignedUrl | service role (passed in) |
| `lib/photos/drive-browse.ts`, `mux.ts`, `video-time.ts`, `mirror.ts` | photo mirror buckets | upload (upsert), download, list | service role (passed in, cron/route) |

Browser code (`src/lib/supabase/client.ts`, anon key) never calls `.storage`: the web uploads
by POSTing the file to the routes above.

**Not covered by this audit:** the native app (`ios/`). If it ever uploads with the anon key
directly, 223 would break it — a read-only grep of `ios/` for `storage/v1` before applying 223
is on the owner checklist.
