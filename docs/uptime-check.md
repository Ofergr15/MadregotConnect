# Uptime check

`GET /api/health` (`src/app/api/health/route.ts`, verdict in `src/lib/health/evaluate.ts`) is the
one URL an external monitor should poll. It is public — a monitor has no session — and returns only
ages and states, never ids, emails or error text.

```json
{
  "status": "ok | degraded | down",
  "checkedAt": "2026-11-28T10:00:00.000Z",
  "checks": {
    "db":          { "state": "ok | down", "ageMinutes": null, "maxAgeMinutes": null },
    "cron_tick":   { "state": "ok | stale | unknown", "ageMinutes": 3,  "maxAgeMinutes": 20 },
    "garmin_sync": { "state": "...", "ageMinutes": 12, "maxAgeMinutes": 360 },
    "strava_sync": { "state": "...", "ageMinutes": 40, "maxAgeMinutes": 360 }
  }
}
```

| Check | Source | Stale after | Why that number |
|---|---|---|---|
| `db` | any of the three reads below succeeds | — | all three failing = DB (or service key) unreachable |
| `cron_tick` | newest `cron_tick_locks.tick_at` | 20 min | tick runs every 5 min (vercel.json) — three missed ticks |
| `garmin_sync` | newest `athletes.garmin_last_sync_at` | 6 h | sync runs */5 02:00–21:59 UTC only, so ~5 h idle overnight is normal |
| `strava_sync` | newest `athletes.strava_last_sync_at` | 6 h | same schedule |

HTTP status: **503 only when `status` is `down`** (database unreachable). A late job is `degraded`
with **200**, so the site is not reported down because one cron is behind.

## Setting up the monitor (owner)

Any free HTTP monitor works (UptimeRobot, Better Stack, Cronitor). Two monitors:

1. **Site down** — HTTP(s) monitor on `https://www.madregot.app/api/health`, every 5 min, alert on
   non-2xx. Catches Vercel down and DB unreachable.
2. **Jobs late** — keyword monitor on the same URL, alert when the body contains
   `"status":"degraded"`, every 15 min, alert after 2 consecutive failures (a single tick
   arriving late should not page anyone).

Do not point the monitor at `/api/ping` for this: ping deliberately touches no database (it exists
for `/offline.html`), so it stays green through a Supabase outage.

## When it alerts

- `db: down` → Supabase status page, then the Vercel env (`SUPABASE_SERVICE_ROLE_KEY`).
- `cron_tick: stale` → Vercel → Cron Jobs for `/api/cron/tick`; check `CRON_SECRET` and the
  `cron_tick_locks.duration_ms` trend (NULL rows = ticks that died before the end).
- `garmin_sync` / `strava_sync: stale` → the sync route's logs; one provider stale and the other
  fresh points at that provider (expired tokens, rate limit), both stale points at the cron itself.
