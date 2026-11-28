# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 186 — join-request decision: reason, pace suggestion, audit

- **Should approve fall back to the pace suggestion when the approver sends no group?** Default shipped: no — the suggestion is applied only with an explicit `acceptSuggestion: true`; without a group it is still `group-required`. The reason is staff-only and never mailed. #179's reason codes (on `signup_requests`) and this free-text audit row can coexist; say if you want one of them only.
