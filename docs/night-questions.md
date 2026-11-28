# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 181 — group chat edit/delete window + audit

- **Should staff be able to delete any message at any age?** Default shipped: yes — the author may edit or delete their own message for 15 minutes; staff (and super users) may delete anyone's message at any age (moderation), never edit it. Every change writes a `group_chat_message_audit` row (migration 346) with the text the room saw, before the Stream call. Open: should the window also bind staff deleting their *own* messages, and should the old text be purged after N days?
