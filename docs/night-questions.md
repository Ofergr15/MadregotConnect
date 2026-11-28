# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 167 — Feature-flag audit

- **Which enablement keys are rolled out or dead?** Default shipped: nothing removed. `docs/flags-audit.md` lists all 113 keys (100 have no reader in this repo — the native app reads them), the `*_FOR_ALL` constants (4 have been `true` for 5–6 weeks, 2 `false` for 7–8 weeks) and a read-only SQL query to run in the Supabase editor that finds club-wide-on and never-used keys. Removal is step-by-step PRs after that answer.
