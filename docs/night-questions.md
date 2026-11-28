# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 172 — OpenAPI spec

- **Serve the spec from the app (a docs page behind staff auth), or keep it a file in the repo?** Default shipped: a file in the repo (`docs/openapi.json` + `docs/openapi.md`), no route and no public page. A public copy would hand out a map of every member route. If you want it in the app, a staff-only `/dashboard/api-docs` page that reads the file is a small follow-up.
- **Include staff routes?** Default: no (142 staff + 15 cron/dev routes are left out, counted in `x-excluded`). They are all in `docs/api-routes.md`.
