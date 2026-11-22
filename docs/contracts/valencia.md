# Valencia tab: server contract for the native client

Tests: `valenciaContract.test.ts`, `eventForecast.test.ts`, `clubUpdatesTopics.test.ts`,
`eventCourseGpx.test.ts`. Events are public reads; updates need a session (`Authorization: Bearer`).

## Events
- `GET /api/events?kind=&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ events: Event[] }` (raw rows, snake_case,
  upcoming-by-overlap by default; bad dates → 400 `{ error }`).
- `GET /api/events/{id}` → `{ event }` · 404 `{ error: "Event not found" }`.
- `Event.course_gpx_url`: https URL of the course GPX, or `null` / absent (absent until migration 200
  is applied). No map → fall back to `lat`/`lng`, `waze_url`, `distances`.

## Forecast: `GET /api/events/{id}/forecast`
- 200 `{ status: "ok", eventId, days: Day[] }`, or `{ status: "no_location", eventId, days: [] }`.
- `Day` is `{ date, status: "available", tMaxC, tMinC, precipProbPct, windMaxKmh, weatherCode }`
  (numbers may be `null`), or `{ date, status: "past" | "not_yet_available" | "error" }`.
  Forecast covers today (UTC) + 15 days; outside that it is `not_yet_available`, never invented.
- 404 event not found · 502 `{ error: "Forecast unavailable" }` (provider down and no good answer in the last 6 h) · 500 on DB error.
- Provider down but a good answer from ≤ 6 h ago exists on that server instance → 200 with `stale: true` and
  `fetchedAt` (ISO), `Cache-Control: no-store`. Show "updated <time>". Upstream timeout is 5 s, no retry.
- `Cache-Control: public, max-age=1800`. `weatherCode` is the WMO code from Open-Meteo.

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
