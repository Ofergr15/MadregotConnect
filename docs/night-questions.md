# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 156 — @mentions in comments and group chat

- **Should a mention reach a coach whose `teammates` category is at its staff default (off)?** Default shipped: no — a mention is kind `mention` → category `teammates`, so a coach who never turned teammates on is not pushed (the inbox row is still written). Say if mentions should bypass the staff-quiet default.
- **Group chat text now carries the feed's `@[Name](id)` token when the composer inserts one.** The web/native chat bubble must render it as @Name (`renderMentionSegments`). Default: server only; no client change in this PR.
