# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 175: bug hunt, poll audience

- **Should staff be able to vote in a poll outside the runner's audience?** Default shipped: no. Staff answering for a runner are held to that runner's audience, so a group's count stays the group's. Staff still see every poll's results.
