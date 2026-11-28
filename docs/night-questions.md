# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 187 — pain report staff follow-up

- **Should a follow-up "closed" also resolve the runner's report (stop the 2-day check-in questions)?** Default shipped: no — follow-up status is the staff side only; closing the report stays on `POST /api/pain-reports/{id}/close`. Who may work it: the report's routed recipients (`painRecipientIds`, i.e. the `pain_report` routing rows) plus admins; a coach the routing screen switched off can still read the report but gets 403 on the follow-up.
