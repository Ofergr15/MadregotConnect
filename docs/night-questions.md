# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 149 — Valencia schedule in Israel and Spain time

- **Where do the departures live, and should events carry an explicit time zone?** The server has no departure-specific data: the Wed/Thu/Fri 2–4.12 departures are whatever events (or event blocks) the staff authored, so the tests use fixture events at Ben Gurion. Shipped: every event in `GET /api/events` and `GET /api/events/{id}` gets an additive `schedule` (UTC `starts_at` + the wall clock at the venue and in Israel), the zone read from the venue's coordinates (Israel / Spain) and otherwise Israel. Default: no migration, no `time_zone` column — if a future trip is outside Israel/Spain, add `events.time_zone` (the code already honours it when present). Also: if the departures are inside a `schedule`/`travel_lodging` block rather than their own events, their times are not converted — tell me the block's config shape and I'll cover it.
