# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 203 — web release checklist

- **Rollback: is "Vercel Instant Rollback, then reset the `production` branch to the previous SHA" the procedure you want, or should `daily-release.yml` get a `rollback` dispatch input that does both?** Default shipped: the two manual steps, documented in `docs/release-checklist-web.md` §7; no workflow change.
