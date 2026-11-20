# Event forecast (Valencia): every server outcome → one honest client state

`GET /api/events/:id/forecast` — **branch only** (`u21-personal-coach`); production `9307dfc8` answers **404**.
Public read, no auth, no DB write. Source: Open-Meteo (no key), 5 s timeout, in-memory cache. Server outcomes are
pinned by `eventForecast.test.ts` (14 tests). Never show a number the server did not send.

| Server answer | Client state |
|---|---|
| `404` (route not deployed, or unknown event) | `unavailable` / `not_deployed` — "תחזית תהיה זמינה בקרוב" |
| `200 { status:'no_location' }` | `unavailable` / `no_location` |
| `200 { status:'ok', days }`, every day `not_yet_available` | `unavailable` / `too_early`, `availableFrom` = earliest day − 15 |
| `200 { status:'ok', days }`, some `available` | `forecast`: render only `available` days; others as "not yet" |
| `200 … stale:true, fetchedAt` | `forecast` with a "updated at <fetchedAt>" line |
| `502` / `500` / network error / timeout | `unavailable` / `fetch_failed` — retry later, no cached guess on the client |
| day `status:'past'` | omit, or "race day passed" |
| day `status:'error'` | that day "unavailable", others still shown |

Client state shape (native, not a server field):
`{ kind:'forecast', days:[...], fetchedAt? } | { kind:'unavailable', reason:'not_deployed'|'no_location'|'too_early'|'fetch_failed', availableFrom? }`

Text only in `unavailable`: no weather icon, no placeholder temperature.
