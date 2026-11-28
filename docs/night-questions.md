# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 202 — stable error codes

- **Convert the remaining ~2,158 inline route error literals to `errorBody()` in one codemod after #231 merges, or route by route as they are touched?** Default shipped: the shared gates (`authError`, the self-or-staff denials, `internalErrorBody`) carry `code` now, which covers most 401/403/500s; a ratchet stops the inline count growing; clients use `errorCodeOf()`, which falls back to the status. A one-shot codemod would touch ~450 route files and collide with most open PRs.
