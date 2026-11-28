# Feed: server contract for the native client

Tests: `feedContract.test.ts` (plus `feedProject.test.ts`, `feedPlanVerdicts.test.ts`).
Every call needs `Authorization: Bearer <supabase jwt>`.

## `GET /api/feed?limit=30&cursor=…`
- 200 `{ items: FeedItem[], nextCursor: string | null }`.
- `limit`: defaults to 20 and is clamped to 1…40, so `limit=30` is fine.
- `cursor`: send `nextCursor` back verbatim (URL-encode it). It is `"<occurredAt>,<id>"` and you should treat it
  as opaque. `nextCursor: null` means you are on the last page. A page can come back **shorter than `limit`, or
  even empty, while `nextCursor` is still set**, because unapproved runners are filtered out after the page is
  cut. Keep paging. A short page does not mean you reached the end.
- The cursor is stable: keyset on `(occurredAt DESC, id DESC)`, so new items arriving while you scroll never repeat
  or skip a row (`feedStableCursor.test.ts`). UTC times come back as `…Z`, microseconds kept. Still dedupe by `id`
  when appending a page (`appendFeedPage` on the web): a refreshed first page swapped in under an older cursor can
  overlap. A cursor that isn't `<ISO instant>,<uuid>` (or a bare ISO instant) is a 400.
- Optional filters: `types=announcement,post` (unknown values are ignored), `squad=<groupId|academy|favorites|mine>`,
  `athlete=<uuid>` (a bad uuid gets 400 `{ error: "Invalid athlete" }`).
- Errors: 401/403 `{ error }` come from the session gate (403 means pending, inactive or no membership).
  An unparseable cursor gets 400 `{ error: "Invalid cursor" }`. Anything else is 500 `{ error: "Failed to load feed" }` (never DB text).

`FeedItem` = `{ id, type: "activity"|"post"|"achievement"|"announcement"|"new_plan", author: { athleteId|null, name,
avatarUrl|null, groupName|null }, body|null, media: [{ path, url, w|null, h|null }], payload|null, occurredAt,
likeCount, commentCount, likedByMe, likePreview: Liker[] (≤3), commentPreview: Comment[] (≤2), canDelete,
activity: FeedActivity|null }`. Decode an unknown `type` defensively. `Liker` = `{ athleteId, name, avatarUrl|null }`.

`FeedActivity` = `{ id, athleteId, garminActivityId|null, activityName|null, activityType|null, startTime, distance (m),
duration (s), movingDuration|null, averagePace (s/km)|null, averageHr|null, maxHr|null, calories|null,
elevationGain|null, locationName|null, perceivedRpe|null, perceivedFeel|null, routePreview: [{lat,lng}]|null,
routeHd, hasRoute, paceBands: number[]|null, lapBands: [{ m, pace, hr? }]|null, stepBands|null,
planVerdict|null, qualityName|null }`.

- `startTime` is the athlete's **wall-clock time written as if it were UTC** (`…+00:00`). Display it in UTC. Never
  convert it to the phone's time zone.
- **Any stat other than distance and duration can be null.** The server has already applied
  `payload.hiddenFields` (`pace`, `heart_rate`, `calories`), for every viewer including the owner. Hiding pace
  nulls `averagePace`, `paceBands`, `lapBands`, `stepBands` and `planVerdict`. Hiding heart rate nulls
  `averageHr`/`maxHr` and removes `hr` from the bands. Show a null as "—". Never work it out from other fields.
- `lapBands[].hr` is a lap's average heart rate and is visible to teammates unless the athlete hid heart rate.
- `planVerdict` only appears on the viewer's own runs, or for staff. Treat it as optional.
- This response never contains the raw `laps`, the `splits` or the full GPS track. For those, see `run-details.md`.

## `POST /api/feed/like { itemId }`
- This is a **toggle**. 200 `{ liked: boolean, likeCount, likePreview: Liker[] }`. Replace the card's like state
  with what comes back.
- 400 `{ error: "itemId required" }` · 404 `{ error: "Feed item not found" }` · 401 with no session ·
  403 for a session with no active athlete row (for example a coach-only account) · 500 `{ error: "Failed" }`.
- If a double tap races, the result is still `liked: true`. Debounce anyway, because two taps that don't race
  turn the like back off.
