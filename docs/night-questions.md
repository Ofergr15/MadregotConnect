# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 183 — photo gallery albums

- **Which week should the gallery group by?** Default shipped: the *plan* week (Sunday–Saturday), because a photo folder is a club session and sessions are planned Sun–Sat. Not the activity week. Event albums take every folder dated inside the event's `[date, end_date]`. `GET /api/photos/albums?by=week|event` (keyset `cursor`) and `GET /api/photos/albums/photos?key=` (offset paging) use the existing signing (mirrored copy, else a signed Drive link), member-only. Open: Monday weeks instead, and should videos be in albums too (photos only for now)?
