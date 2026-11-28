# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 153 — Scheduled messages/polls (composer model + dry-run sender)

- **When should the composer really send, and should `/api/cron/scheduled-composer` be put on a schedule?** Default shipped: the model is a separate table (`scheduled_composer_items`, migration 327, file only), so the real sender (`/api/cron/notifications`, which reads `scheduled_notifications`) never sees these rows. The cron is a dry run only: it records each due occurrence in `scheduled_composer_dry_runs` with its audience and device counts, then moves the item on to its next time. It is NOT in vercel.json. Writes are for approvers, admins and the super user (the same people who publish surveys); reads are for any staff member. "High" importance is stored but changes nothing yet; it is meant to map to a time-sensitive push once sending exists.
