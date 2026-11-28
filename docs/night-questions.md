# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 185 — staff moderation API

- **Should the reporter be told when their report is acted on?** Default shipped: nobody is notified — not the reporters, not the author. `POST /api/moderation/reports {reportId, action: dismiss|resolve|hide, note?}` decides on the report's *target*, so every open report on that post/comment/message closes at once, and one `moderation_actions` row (migration 348) records who, what, the outcome and how many reports it closed. "Hide" uses the content's own soft delete (feed `deleted_at`, Stream soft delete for chat). Drive photos answer 422. Open: notify reporters? And should hide on a photo untag/hide it from the gallery?
- Separate routes (`/api/moderation/reports`, `/api/moderation/actions`); the existing `/api/moderation/report` (and #155's dedupe change to it) is untouched.
