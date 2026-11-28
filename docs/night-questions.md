# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 168 — Data retention

- **Turn the purge on, and are the windows right?** Default shipped: the daily job is a **dry run** (counts only) until `RETENTION_PURGE=on` is set in Vercel. Windows: notifications 400 d (sent/cancelled, never ledger or recurring), push deliveries 90 d, client events 90 d, email log 365 d (bounces/complaints kept), race positions 2 d, login codes/handoffs 7 d after expiry. Chat is not purged (no approved policy).
