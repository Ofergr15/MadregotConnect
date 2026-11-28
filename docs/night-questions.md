# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 176 — Race-live load guard

- **Are the in-memory, per-instance limits right for race morning: 12 position writes/min per runner, 6 board builds/min per viewer, degraded mode at 8 boards building at once or 80 built in 10 s on one instance?** Default shipped: those numbers. A viewer over the limit gets their own last board back (200, `degraded: "viewer-limit"`); a busy instance serves one shared no-viewer snapshot per event (no positions, no opted-out runners, rebuilt at most every 15 s); a failing DB serves the last snapshot up to 10 min old (`degraded: "error"`). Cached boards never carry positions older than 60 s. The viewer page ignores the new `degraded`/`snapshotAt` fields for now; showing a "delayed" note is a UI follow-up.
