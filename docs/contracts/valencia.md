# Valencia tab: server contract for the native client

Tests: `valenciaContract.test.ts`, `eventForecast.test.ts`, `clubUpdatesTopics.test.ts`,
`eventCourseGpx.test.ts`. Events are public reads; updates need a session (`Authorization: Bearer`).

## Events
- `GET /api/events?kind=&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ events: Event[] }` (raw rows, snake_case,
  upcoming-by-overlap by default; bad dates → 400 `{ error }`).
- `GET /api/events/{id}` → `{ event }` · 404 `{ error: "Event not found" }`.
- `Event.course_gpx_url`: https URL of the course GPX, or `null` / absent (absent until migration 181
  is applied). No map → fall back to `lat`/`lng`, `waze_url`, `distances`.

## Forecast: `GET /api/events/{id}/forecast` — v2 (local branch `u21-manager-events`, not deployed)
Full contract: `event-forecast.md`; exact example: `fixtures/event-forecast.v2.example.json`.
- **v1 parsers keep working:** `status` (`ok` | `no_location`), `eventId` and `days[]` (per race date:
  `available` with numbers, or `past` | `not_yet_available` | `error`) are still in every 200, now read from the
  provider's returned window in the venue timezone. `stale` + `fetchedAt` as before.
- **One v1 behaviour changed:** provider down with no cached answer is now **200** (`days[].status: "error"`,
  `unavailableReason` set) instead of **502**. 404 stays for an unknown event; 500 for a DB error.
- **New in v2 (`version: 2`):** `current`, `daily` (all 16 returned days), `validFrom`/`validThrough`, `timezone`,
  `raceDayStatus` + `raceDayReason`, `raceHourly`, `unavailableReason`, `provider`, `attribution`.
- Cache: `public, max-age=1800` for a fresh answer; `no-store` for stale or unavailable.

## Updates for this event
- `GET /api/club-updates?event={eventId}` (or `?topic={topicId}`) →
  `{ enabled, canWrite, admin, me, missing, updates: ClubUpdate[], topic }`.
  `topic` = `{ id, eventId, name, pinnedText, opensAt, closesAt }` or `null`
  (no topic → `updates: []`). With `?event=`, `updates` spans all of the event's topics but `topic`
  is the first by `opensAt`. Malformed id → 400 `{ error: "invalid id" }`.
- `GET /api/club-updates/topics?event={eventId}` → `{ enabled, missing, topics: Topic[] }`
  (or `{ enabled: false, topics: [] }` when updates are switched off for this member).
- Without a filter, `GET /api/club-updates` is unchanged (no `topic` key).
- `ClubUpdate` = `{ id, author: { id, name, avatarUrl, role }, body, imageUrl, breaking, pinned,
  topicId, createdAt, editedAt, reactions: [{ emoji, count, mine }] }`.
- `missing: true` = migration 154 not applied: show empty, not an error.

## Surveys
See `valenciaContract.test.ts`: `GET /api/surveys/open` → `{ polls: [{ id, question, closesAt }] }`
(max 3, failure is also `{ polls: [] }`); `GET /api/surveys/{id}?athleteId=` and
`POST /api/surveys/{id}/respond { athleteId, optionIndex }` → `{ success, answers }`.
Without a session the detail returns only `{ survey, myResponse }` — treat `myResponses`/`results`
as optional. Anonymous polls show `anon-N` ids to members; staff see names.
