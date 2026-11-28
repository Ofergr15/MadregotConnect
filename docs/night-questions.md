# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 197 — iOS route contracts

- **Should a new enum value (e.g. a sixth feed item `type`) count as breaking?** Default shipped: yes — Swift `Codable` string enums throw on an unknown value, so `iosRouteContracts` fails until the baseline is re-accepted (`cp docs/contracts/ios-routes.json docs/contracts/ios-routes.baseline.json`). If the native app decodes enums leniently (`unknown` fallback case), say so and the rule can drop to a warning.
