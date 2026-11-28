# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 179 — Post-race results data

- **"Garmin wins" applied literally: a synced Garmin activity's time beats the staff-typed official chip time?** Default shipped: yes — order is Garmin activity > Strava activity > live finish split (manual > feed > LiveTrack). The activity time is its elapsed time (pauses included; moving time only if migration 166 is missing), from a run on the event's date of 40.1–45.6 km. Every source is returned next to the chosen one with `deltaToLiveSec`, so a watch stopped late is visible. If the official chip time should win instead, it is a one-line change in `reconcile()`. API only (`GET /api/race-live/{eventId}/results`, same gate as the board); no page yet.
