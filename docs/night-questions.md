# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 196 — push dry run

- **Turn on `PUSH_DRY_RUN=1` for Vercel preview deployments?** Default shipped: off everywhere; tests use `setPushDryRun`. When on, every push walks the full pipeline and writes `push_deliveries` rows marked `dry-run` (counted as muted on the push-health screen), and nothing reaches a phone. Dead-token pruning on 404/410 already existed; a dry run exercises it only from a test simulator.
