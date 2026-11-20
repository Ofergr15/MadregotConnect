# Event updates (Valencia): read by event, publish to its topic

Status: the `?event=`/`?topic=` filters and `/api/club-updates/topics` are **branch only** (`u21-personal-coach`);
production `9307dfc8` has the unfiltered stream and POST only. Tables: migration **154** (`club_update_topics`,
`club_updates`). Pinned by `clubUpdatesTopics.test.ts`, `clubUpdatesRoute.test.ts`.

## Gate (all three routes): `clubUpdatesCaller` → `accessFor(config, athleteId, admin)`
= `capabilities.clubUpdates` (`/api/me/capabilities`). `read` false → `200 { enabled:false, updates:[] }` (not 403).

## Read (no write, no push)
- `GET /api/club-updates/topics?event=<eventId>` →
  `{ enabled, missing, topics: [{ id, eventId, name, pinnedText, opensAt, closesAt }] }`
- `GET /api/club-updates?event=<eventId>` (or `?topic=<topicId>`, optional `&feed=1` = last 24 h, max 3) →
  `{ enabled, canWrite, admin, me, missing, updates: [...], topic: <first topic> | null }`.
  Unknown event → `topic: null, updates: []` — never the whole stream. Malformed id → `400`.
  `missing: true` = migration 154 not applied; render "updates unavailable", not "no updates".

## Publish: `POST /api/club-updates`
Body `{ body (≤280 visible chars), topicId?, imageUrl? (https), breaking?, pinned? }`. Needs `clubUpdates.write`.
- **Push rule** (`wantsPush`, `lib/club-updates/server.ts:221`): pushes only when `breaking: true` **or** the body
  @-mentions a member, and only after a 6 s undo window (`UNDO_MS`). So a **silent** post = `breaking` absent/false and
  no mention. Response `{ update, push }`; `push` is the decision, not delivery.
- Unknown `topicId` → `400`; table missing → `503 "migration 154 not applied"`.
- Synthetic fixtures must use non-breaking, mention-free bodies.

## Gap: no route creates a topic
Nothing in `src/app/api` inserts into `club_update_topics`; a Valencia topic (`event_id` = the event) exists only if
inserted in the DB. Options, each needs authority: (a) staff `POST /api/club-updates/topics { eventId, name }`
(admin-gated, no push); (b) a one-row SQL insert by the owner. Until then the native screen must handle `topics: []`.
