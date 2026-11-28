# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 180 — group chat read receipts

- **Should members see how many messages each teammate hasn't read?** Default shipped: `GET /api/group-chat/receipts` shows every member *who* has read up to a message (and when), but the per-member unread count is filled only for staff (`unread: null` for a member). Open: show it to members too, or hide receipts from members entirely?
- Builds on #232 (unread per group + mark-read, still open); this PR adds the per-member side and does not touch #232's files. Migration 345 indexes `athletes(group_id)` and the coach roles, which every chat route reads to resolve the room.
