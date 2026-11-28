# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 151 — "Who hasn't run" + bulk message

- **Should the bulk message to "who hasn't run" really send (one `coach_message` per person, the same as POST /api/coach/message), and is 20 dry runs an hour per staff member the right limit?** Default shipped: dry run only — `dryRun: false` is refused with 400; every dry run is an audit row in `staff_bulk_message_log` (migration 325, file only), and those rows are the rate limit (20/hour per staff member). "Hasn't run" = no run in the current activity week (Monday–Sunday, the watch's week); strength sessions don't count as a run.
