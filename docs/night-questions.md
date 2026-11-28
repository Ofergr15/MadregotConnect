# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 159 — New PR on sync: twins + feed card

- **Should the club see a feed card when a member breaks their own PR?** Default shipped: behind `personal_record_feed` (default off). The card names the distances and links to the run, with no time on it, so hide-pace can't leak through a frozen payload. The push to the runner is unchanged and still always on.
