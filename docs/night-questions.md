# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 165 — Staff status API

- **Want a web page on top of `GET /api/admin/status`, and alert thresholds?** Default shipped: the API only (counts + timestamps, staff-only, no-store). No thresholds are applied; the public `/api/health` keeps the alerting verdicts. Cron detail is per-cron once `cron_runs` (#236) is applied, the tick heartbeat until then.
