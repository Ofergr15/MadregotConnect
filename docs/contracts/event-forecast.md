# Event forecast: contract v2 (candidate for main; not deployed)

`GET /api/events/:id/forecast`. Not on main or production yet: both answer **404** today (route absent). This branch adds it.
Public read, no auth, no DB write. Provider: Open-Meteo (`forecast_days=16`, `timezone=auto`, no key).
Terms/eligibility for this use are **unverified** (docs, pricing and licence pages to be reviewed); no paid setup.
Pinned by `eventForecast.test.ts`, `eventForecastStates.test.ts`, `eventForecastFixture.test.ts` (51 tests, synthetic payloads).

## Response (200 for every outcome except an unknown event → 404)
Exact example: `fixtures/event-forecast.v2.example.json`. v1 fields kept for existing parsers: `status`, `days[]`.
```json
{
  "version": 2, "status": "ok" | "no_location", "days": [ /* v1 per-race-date */ ],
  "provider": "open-meteo",
  "attribution": { "name": "Open-Meteo", "url": "https://open-meteo.com/" },
  "eventId": "…", "location": { "lat": 39.4699, "lng": -0.3763 } | null,
  "timezone": "Europe/Madrid" | null, "utcOffsetSec": 3600 | null,
  "fetchedAt": "2026-11-20T10:00:00.000Z" | null, "stale": false,
  "validFrom": "2026-11-20" | null, "validThrough": "2026-12-05" | null,
  "current": { "time", "temperatureC", "apparentC", "precipitationMm", "windKmh", "weatherCode" } | null,
  "daily": [{ "date", "tMaxC", "tMinC", "precipProbPct", "windMaxKmh", "weatherCode" }],
  "raceDate": "2026-12-06", "raceDates": ["2026-12-06"],
  "raceDayStatus": "available" | "partial" | "out_of_range" | "unavailable",
  "raceDayReason": "after_horizon" | "before_horizon" | "no_data" | null,
  "raceHourly": [{ "time": "2026-12-06T08:00", "temperatureC", "precipProbPct", "windKmh", "weatherCode" }],
  "unavailableReason": "no_location" | "provider_error" | "invalid_payload" | "rate_limited" | "timeout" | null
}
```
- **Readiness comes from the dates the provider returned** (`validFrom`..`validThrough` = `daily.time`), never from this
  server's clock: the venue's "today" decides (a UTC server and a UTC+1 venue disagree for an hour each night).
- A race date counts as `available` only when its day has at least one real value; a date with every field null is
  `unavailable` / `no_data` (v1 day `error`), and one such day in a multi-day event makes it `partial` / `no_data`.
- `timezone` is the provider's IANA name if the runtime knows it, else `null` (missing, malformed, or a made-up
  zone like `Fake/Zone`); no default zone is ever assumed. `utcOffsetSec` is the provider's offset (−12 h…+14 h) or
  `null`; with `timezone` null a client can still place the venue-local times with it. Additive in v2.
- Impossible dates (`2026-99-99`, `2026-02-30`) in the event or the payload are ignored, never a crash.
- Exact bodies for every state the client must render: `fixtures/event-forecast.v2.states.json`.
- Coordinates outside the globe (|lat| > 90, |lng| > 180) are treated as no location.
- Unknown values are `null`, never `0`. Times in `raceHourly` / `current.time` are venue-local wall time.
- Valencia: on Nov 20 the window is Nov 20 – Dec 5 → current + 16 days shown, race day `out_of_range`/`after_horizon`.
  From Nov 21 (venue date) it is `available` with its hours. Race start time is not stored here; the client picks hours.

## Failures
- Cached per venue: fresh for 30 min (no provider call), concurrent misses share one request, 200 entries max.
  `Cache-Control: public, max-age=<seconds of freshness left>` (1800 when just fetched), so no copy anywhere is older than 30 min.
- A 200 with no usable weather (empty, junk, all null) is `invalid_payload`: never cached, never replaces a good answer.
- Provider error / 429 / timeout: the last good copy up to 6 h old with `stale: true` (`no-store`), else an
  `unavailable` DTO with `unavailableReason` (`no-store`), current/daily empty. Upstream text never leaks.
- The map must render regardless: weather failing never hides the course.

## Client states
`unavailableReason != null` → text-only "weather unavailable" (reason-specific). Otherwise show `current` and `daily`;
the race card follows `raceDayStatus` (`out_of_range` + `after_horizon` → "race-day forecast from <raceDate − 15>").
`stale` → "updated at <fetchedAt>".
