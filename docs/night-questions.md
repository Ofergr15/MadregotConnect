# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 191 — Garmin credential health for staff

- **Should the reconnect prompt be pushed to the member automatically, or only shown to staff to send?** Default shipped: built, never sent. `GET /api/admin/garmin-health` returns it per refused athlete in their language; nothing sends it. #230 already gives the member's own screen `garminReconnect`.
