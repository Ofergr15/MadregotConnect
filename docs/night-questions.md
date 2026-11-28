# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 178 — Live share expiry

- **Is 2 h after the finish the right cut-off, and should the clock start at the moment the finish time reached us (`race_splits.recorded_at`) rather than the actual line crossing?** Default shipped: 2 h from the earliest of the finish split's `recorded_at` and a GPS-only finish estimate (≥ 42.3 km, from the device's own pace). A finish that staff type in late starts the 2 h late too. Stop-sharing (`sharing_stopped_at`, #154) is honoured as soon as that column is selected by the board; until #154 merges it is a no-op. Read side only: the board stops serving the position; the row itself still goes with the 24 h purge.
