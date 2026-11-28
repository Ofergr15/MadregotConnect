# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 150 — Manager home counts

- **Should "unpaid" in "מחכה לך עכשיו" also count academy GO payment links, not only store orders waiting for payment?** Default shipped: store orders in `pending_payment` only; the academy payment board stays on the finance screen (`/api/admin/finance`), which already owns that rule. An academy manager gets `unpaid: null` (no money screen for that role).
