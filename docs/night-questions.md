# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 157 — Kudos counts consistent between feed, run detail and notifications

- **`GET /api/activities/[id]/kudos` has no verified viewer (the service worker calls it), so it answers as a non-staff member: a test account's kudos is hidden from everyone but that account.** Staff see those kudos on the feed card but not here. Default shipped: the member view. Gating the route on a session would change who can call it, so that is left for a decision.
