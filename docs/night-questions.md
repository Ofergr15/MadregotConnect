# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 174 — race-live Playwright smoke

- **Admin race settings have no web screen, so the smoke covers only the viewer and the event-page button.** Race settings are the config API (`PUT /api/race-live/[eventId]/config`; task 148 adds the admin endpoint). Default: no UI test until there is a screen. Should the web get a staff settings page, or is that native-only?
- **When should it run?** Default: by hand, `npm run test:race-live` (a fake-env build plus 6 tests, about 13 s once built). It is not on pull_request or nightly. Suggestion: run it once before 6.12.
