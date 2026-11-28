# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 199 — i18n ICU parity

- **`nav.social` reads "Social" in Hebrew too — translate it?** Default shipped: unchanged (it may be a deliberate English tab name). Everything else he.json leaves in Latin script is a brand (Garmin, Strava, WhatsApp, Google) or a placeholder-only string.
