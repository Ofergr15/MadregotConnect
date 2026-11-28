# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 195 — activity-time audit

- **None blocking.** Four date reads used the viewer's timezone, Israel time on top of the wall clock, or the UTC day: workout-feedback's missing card, the profile runs list, the champions race date and GoalSheet's today. They now go through `formatActivityDateWith` / `activityLocalDateStr` / `israelToday` (RunChatPanel, already pinned, moved to the helper too), and a ratchet test fails on any new `new Date(x.start_time).getHours()/toLocale…()`. The run-chat AI route's `getUTCDay()` was already correct and is left alone, because #226 edits that file's imports.
