# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 146 — race-day dry run

- **A phone that restarts mid-race loses the distance run while it was off (≈ 700 m for 3 min).** Should the server fill the gap (e.g. estimate from the last pace × offline time, or snap to the next official split), or keep showing only what was measured? Default shipped: nothing changes in the server — the dry run just measures and documents it (docs/race-day-dryrun.md). The board's official splits are unaffected.
