# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 170: no `any` outside catch clauses

- **Should the src/ ratchet fail on a stale baseline, like #224's does for src/app/api?** Default shipped: no. It fails only when a file gains an `any`. #205 and #224 remove `any` in parallel, so a strict check would turn main red for whichever PR merged second. Once those merge, switching to strict is a one-line change.
