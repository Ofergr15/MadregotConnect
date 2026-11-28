# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 192 — Strava webhook verification

- **Set `STRAVA_WEBHOOK_SUBSCRIPTION_ID` in Vercel?** Strava does not sign webhook events, so the strongest check is that `subscription_id` is ours. Default shipped: checked only when the env var is set (unset = today's behaviour). Shape and a 24 h replay window are always enforced. Durable dedupe needs migration 356; until then the in-memory set is used, as before.
