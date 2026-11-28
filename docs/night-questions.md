# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 152 — Move runner between packs (atomic)

- **Should the existing coach move in PUT /api/athletes (the web pack sheet) also go through `move_athlete_group()` once migration 326 is applied?** Default shipped: no. The new `POST /api/admin/pack-move` (for the native screens) is atomic and audited: one function writes group_id, the pack history and the audit row in a single transaction, and returns 409 until 326 is pasted. PUT /api/athletes keeps its current best-effort path. Any staff member can move a runner, the same as today. The move takes effect from today, and a member's pending Saturday change is cancelled and named in the summary.
