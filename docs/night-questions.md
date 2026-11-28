# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 148 — race settings admin API

- **Window bounds beyond the task's rule.** Shipped: `pollTo ≥ start + 6:30` (the task), plus `pollFrom ≤ start`, `pollFrom` no more than 12 h before the gun, `pollTo` no more than 24 h after it, and the start on the event's date (±1 day). Times must carry an explicit zone (`+01:00` / `Z`) — a zoneless time is refused, since the admin is in Israel and the race in Spain. Should `pollFrom` have a tighter lead (e.g. ≤ 2 h)? Default: 12 h. Migration 320 (`race_live_config.race_start_at` + a CHECK with the same 6:30 rule) is a file only, not applied; until it is, the endpoint answers 503 and `PUT …/config` keeps working as before.
