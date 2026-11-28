# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 194 — 1000-row cap audit

- **Page the club-wide `push_subscriptions` reads too (entry-queue, admin/notifications, bugs/run)?** They are around a few hundred rows today, so they were left alone. Default shipped: not paged; if the club passes ~800 devices, they are the next to page. Shoe mileage is left to #200.
