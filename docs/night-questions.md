# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 158 — Weekly summary "best of the week"

- **Should the fastest km count only runs the athlete didn't mark as a race / treadmill, and should `best` be hidden on a week with a single run?** Default shipped: every qualifying run counts (the same set as the summary's km), kms faster than 2:00 are dropped as GPS glitches, and `best` always ships. The client decides what to show.
