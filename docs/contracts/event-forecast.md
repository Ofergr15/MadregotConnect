# Event forecast (Valencia): contract v2 (branch `u21-manager-events`, local; not deployed)

`GET /api/events/:id/forecast`. Branch-only; production `9307dfc8` answers **404** (route absent).
Public read, no auth, no DB write. Provider: Open-Meteo (`forecast_days=16`, `timezone=auto`, no key).
Terms/eligibility for this use are **unverified** (docs, pricing and licence pages to be reviewed); no paid setup.
Pinned by `eventForecast.test.ts` (20 tests, synthetic payloads).

## Response (200 for every outcome except an unknown event → 404)
```json
{
  "provider": "open-meteo",
  "attribution": { "name": "Open-Meteo", "url": "https://open-meteo.com/" },
  "eventId": "…", "location": { "lat": 39.4699, "lng": -0.3763 } | null,
  "timezone": "Europe/Madrid" | null,
  "fetchedAt": "2026-11-20T10:00:00.000Z" | null, "stale": false,
  "validFrom": "2026-11-20" | null, "validThrough": "2026-12-05" | null,
  "current": { "time", "temperatureC", "apparentC", "precipitationMm", "windKmh", "weatherCode" } | null,
  "daily": [{ "date", "tMaxC", "tMinC", "precipProbPct", "windMaxKmh", "weatherCode" }],
  "raceDate": "2026-12-06", "raceDates": ["2026-12-06"],
  "raceDayStatus": "available" | "partial" | "out_of_range" | "unavailable",
  "raceDayReason": "after_horizon" | "before_horizon" | null,
  "raceHourly": [{ "time": "2026-12-06T08:00", "temperatureC", "precipProbPct", "windKmh", "weatherCode" }],
  "unavailableReason": "no_location" | "provider_error" | "rate_limited" | "timeout" | null
}
```
- **Readiness comes from the dates the provider returned** (`validFrom`..`validThrough` = `daily.time`), never from this
  server's clock: the venue's "today" decides (a UTC server and a UTC+1 venue disagree for an hour each night).
- Unknown values are `null`, never `0`. Times in `raceHourly` / `current.time` are venue-local wall time.
- Valencia: on Nov 20 the window is Nov 20 – Dec 5 → current + 16 days shown, race day `out_of_range`/`after_horizon`.
  From Nov 21 (venue date) it is `available` with its hours. Race start time is not stored here; the client picks hours.

## Failures
- Cached per venue: fresh for 30 min (no provider call), concurrent misses share one request, 200 entries max.
- Provider error / 429 / timeout: the last good copy up to 6 h old with `stale: true` (`no-store`), else an
  `unavailable` DTO with `unavailableReason` (`no-store`), current/daily empty. Upstream text never leaks.
- The map must render regardless: weather failing never hides the course.

## Client states
`unavailableReason != null` → text-only "weather unavailable" (reason-specific). Otherwise show `current` and `daily`;
the race card follows `raceDayStatus` (`out_of_range` + `after_horizon` → "race-day forecast from <raceDate − 15>").
`stale` → "updated at <fetchedAt>".
