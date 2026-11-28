# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 154 — Poll results per pack

- **Should a runner count in the pack they were in when they answered, rather than the pack they are in now?** Default shipped: the pack they are in now, matching the "who hasn't answered" list on the same screen. `byGroup` holds counts only (asked, answered, per option, response %), so it is identical for anonymous polls. Note: the existing `options[].people` names on this route are returned even for an anonymous poll. That is unchanged here and left for the screen to hide; tell me if the server should drop them.
