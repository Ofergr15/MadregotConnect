# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 188 — unpaid list + CSV

- **Should podium over-budget orders waiting for approval appear in the unpaid list/CSV?** Default shipped: no — they wait for an approval, not a payment; the list is academy months not settled + store orders in `pending_payment`. Manager-only (same gate as כספים), so coaches get 403.
