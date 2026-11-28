# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 147 — race-live viewer stale fallbacks

- **Stale after 2 min (the task) or 3 min (the 28.11 decision in viewer.ts)?** Default shipped: 3 min, the existing `STALE_MS` — LiveTrack posts every 2 min, so a 2 min threshold would flicker healthy runners to "not updated" between posts. The new last-split line and "עודכן לפני X דק׳" (row and board-wide) follow `STALE_MS`, so switching to 2 min is a one-constant change. Finish detection (≥ 42.3 km) and the results freeze are PR #218 and are not repeated here.
