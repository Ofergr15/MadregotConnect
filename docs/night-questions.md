# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 193 — cron overlap lock

- **When the lock table cannot be read (migration 355 not applied, database hiccup), should the sync run anyway or skip?** Default shipped: run anyway (fail open), logged as `[cron-lock] ... running unlocked` — the same behaviour as before the lock existed. Only `cron/sync` takes the lock; `withCronLock` is generic if you want it on tick/wellness too.
