# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 182 — group chat photo messages

- **How long should a chat photo link live, and should we keep the camera original?** Default shipped: links are signed for 5 minutes per read (the client re-asks with `GET /api/group-chat/photos?messageIds=`), and only three re-encoded WebP sizes (320 / 1080 / 2048 long edge, EXIF and GPS dropped) are stored in the private `group-chat-media` bucket (migration 347) — the original is never kept. Open: longer TTL for flaky connections, or a full-resolution download for staff?
- Built standalone from main (does not import #255's variant helpers or #246's `/api/files` route, both still open); when those merge, the sharp step can move onto `lib/images/variants-server.ts`.
