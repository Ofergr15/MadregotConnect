# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 177 — Race-day runbook

- **Valencia `pollTo`: 14:45 Valencia (gun 08:15 + 6:30), not the 14:30 in the older `docs/race-live.md` step 6?** Default shipped: the runbook says 14:45, because the race settings API (#262) refuses anything shorter than start + 6:30 and the slowest runner needs the window open. Also: the runbook asks for no release approval on Sat 5 and Sun 6 Dec.
