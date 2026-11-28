# Race-day runbook — Valencia, Sunday 2026-12-06

One page for the people on duty. It says what to check and when, how to read the health signals,
and how to back out. The design is in `docs/race-live.md`. The phone-sharing details and the
4xx table are in `docs/live-tracking-race-day.md`. Generic incidents (Garmin, Strava, crons,
missing migrations) are in `docs/runbook.md`.

Times: the gun is **08:15 Valencia = 09:15 Israel** (CET is UTC+1, Israel is UTC+2). Every API
time carries an explicit zone. Write `2026-12-06T08:15:00+01:00`, never a zoneless time.

Variables used below:

```bash
APP_URL=https://www.madregot.app
EVENT_ID=<the Valencia event id>
JWT=<an admin's bearer token>      # staff/admin routes
CRON_SECRET=<from the repo secrets> # cron route only (owner)
```

Every call in this file is either a read or a race-live config change. None of them touches
migrations, flags for the whole club, or production deploys unless the step says **(owner)**.

---

## What has to be true before T-24h (by Friday 4 Dec)

| What | How to check | Who |
|---|---|---|
| `196_race_live.sql` applied | `GET $APP_URL/api/race-live/$EVENT_ID/config` returns `{config: …}` and not a 500 | owner |
| Race-live server code is on `main` **and** on `production` | the `race-live` workflow runs from the default branch only. The routes must answer on prod: `curl -s -o /dev/null -w '%{http_code}' $APP_URL/api/race-live/$EVENT_ID` is **401** (gated), not 404 | owner |
| Repo secrets `APP_URL` and `CRON_SECRET` set | GitHub → Settings → Secrets → Actions | owner |
| Rehearsal done (replay, pushes to staff only) | `docs/race-live.md` step 5. If the dry run (PR #250) is merged, also run `docs/race-day-dryrun.md` against a local server | staff |
| Optional pieces from open PRs, **only if merged**: stop-sharing holds (#154, migration 225), race settings API (#262, migration 320), finish freeze (#218), stale split (#253), load guard (#276), live share expiry (task 178), results data (task 179), staff status API (#271) | `git log origin/production --oneline \| grep -E '#154\|#262\|#218\|#253\|#271\|#276'`. A PR that is not merged is not part of the race. Don't merge new race-live code after Friday | owner |

**Release freeze.** The daily release ships whatever the owner approved at 20:00 Israel. Don't
approve a release on **Saturday 5 Dec** or **Sunday 6 Dec**. A deploy during the race replaces
the warm instances. With the load guard it also resets the in-memory rate limits and snapshots.

---

## T-24h — Saturday 5 Dec, evening

1. **Health is green.**
   `curl -s $APP_URL/api/health | jq` → `"status":"ok"`. See "Reading the health API" below.
   `degraded` because `garmin_sync`/`strava_sync` are stale overnight is normal (sync stops at 22:00 UTC).
   `cron_tick: stale` is not normal. Fix it with `docs/runbook.md` → "A cron fails" before race day.
2. **Cron pause is off.** `select value from app_settings where key = 'cron_paused'` must not be
   `'on'`. **`cron_paused` also silences `/api/cron/race-live`**: it returns `{paused:true}` and polls nothing.
3. **Entries.** Every Valencia runner has a `race_entries` row with a bib, and the goal if known.
   There is no list endpoint for entries. Read the board as staff (`GET $APP_URL/api/race-live/$EVENT_ID`):
   every runner on it has a row, and `bib`/`goalSec` show what is stored. A missing runner needs
   `PUT …/entries {"athleteId":"…","bib":"…","goalSec":…}`.
   A phone with no row gets `403 not-on-board` all morning.
4. **Flags.** `race_live_phone` is on **per athlete** for the runners who will share from the
   phone. `race_live` is on for the runners and the staff. The club comes later (race morning).
5. **LiveTrack links.** Each runner pastes the personal link and taps בדיקת הקישור. On the board
   (staff), the runner's own row shows `liveTrack.state`. `ready` or `active` is fine. `error:passcode`
   means "turn the passcode off" (`docs/race-live.md`).
6. **Window and gun time.** Not active yet. Set the window now so nobody has to type it at 07:00:
   ```bash
   curl -s -X PUT $APP_URL/api/race-live/$EVENT_ID/config -H "Authorization: Bearer $JWT" \
     -H 'Content-Type: application/json' \
     -d '{"source":"manual","active":false,"pushEnabled":false,"pollFrom":"2026-12-06T07:45:00+01:00","pollTo":"2026-12-06T14:45:00+01:00"}'
   ```
   `pollTo` has to cover the slowest runner. Gun 08:15 + 6:30 = 14:45 at the earliest. If the
   race settings API (#262) is merged and migration 320 is applied, set the times there instead.
   It refuses a `pollTo` earlier than start + 6:30:
   `PUT …/settings {"startAt":"2026-12-06T08:15:00+01:00","pollFrom":"2026-12-06T07:45:00+01:00","pollTo":"2026-12-06T14:45:00+01:00"}`.
7. **Read back** `GET …/config`. Check `active:false`, `source:"manual"`, the window as typed
   (stored in UTC: `06:45Z` / `13:45Z`), `fail_count: 0`, and `last_error: null`.

## T-1h — Sunday 6 Dec, 07:15 Valencia / 08:15 Israel

1. `GET /api/health` → `ok`, or `degraded` from the sync checks only. If it says `down`, the
   database is unreachable: see the rollback section, step 4.
2. **Open the race:**
   ```bash
   curl -s -X PUT $APP_URL/api/race-live/$EVENT_ID/config -H "Authorization: Bearer $JWT" \
     -H 'Content-Type: application/json' -d '{"active":true,"pushEnabled":true}'
   ```
3. **Start the poller by hand** at ~07:45 Valencia: GitHub → Actions → `race-live` → Run
   workflow (`minutes: 420`). The 06:45 UTC schedule is only a backup, because GitHub schedules lag.
   Two runs at once are harmless (the milestone ledger claims each push once), but cancel the extra one.
4. **First poll answers.** In the workflow log, each minute prints the tick result:
   `{"races":1,"polled":…,"changed":…,"pushed":…,"errors":[]}`. `races:0` means the config is not
   active or the migration is missing. `{"paused":true}` means `cron_paused` is on. `401` means the
   `CRON_SECRET` values don't match **(owner)**.
5. **Turn `race_live` on for the club** (Settings → feature flags), so every member can see the board.
6. **Smoke the board as a member:** open the event → צפייה חיה. Every runner shows "not started"
   with a bib. A runner who opted out is absent. That is intended.

## Start — 08:15 Valencia / 09:15 Israel

1. Within ~2 min of the gun, phone-sharing runners appear with a position, for members who
   opted in to the map. Watch runners appear after their LiveTrack session starts.
2. Staff enter **start** for anyone whose watch or phone isn't reporting (optional: it pushes "יצא/ה לדרך").
3. Watch the config every ~15 min:
   `GET …/config` → `last_polled_at` within the last 2 min, and `fail_count` 0. A `last_error`
   such as `feed refused (403)` only matters on `source:"feed"`. On `manual` nothing is fetched
   from the organizer.
4. Phones answering 4xx: see the table in `docs/live-tracking-race-day.md`. A short burst of
   `429 too-soon` is harmless. With the load guard merged, a `429 rate-limited` with a
   `Retry-After` header means a phone sent more than 12 points in a minute (a retry loop). It clears
   by itself within the minute.

## During the race — half and finish

- Staff enter **half** and **finish** chip times off the official app (`docs/race-live.md` →
  "Manual entry"). A manual time always beats the watch. A corrected time updates the board and the
  feed card, but **the push already sent is not re-sent**.
- **Board answers with `degraded`** (load guard): `"viewer-limit"` means that viewer polls too
  fast and gets their own last board. `"busy"` means this instance is serving a shared snapshot
  with no positions, rebuilt every 15 s. `"error"` means the DB failed and the last snapshot is
  served (up to 10 min old). `snapshotAt` says how old it is. One `busy` is fine. A steady `error`
  means the DB is in trouble: see the rollback section, step 4.

## Finish — the last runner in, then the window close

1. Every finisher has a **finish** split (manual or watch). A watch-only finish appears only once
   the session ended with ≥ 41 km. Enter the chip time anyway, because that is the official one.
2. Feed cards: one `achievement` card per finisher, "מרתון ולנסיה · h:mm:ss".
3. After the last runner: `PUT …/config {"active":false}`. Positions disappear from the board at
   once and phone writes get `409 out-of-window`. The board stays as results. With #218 merged,
   it freezes as results 30 min after `pollTo` anyway.
4. Cancel the `race-live` workflow run (it would otherwise loop until `minutes` runs out).
5. **Retention:** every position and LiveTrack link is purged 24 h after `pollTo` by the poller's
   own tick. With the poller stopped, that purge runs on the next tick that sees the config. If
   positions must go now, a runner's own `DELETE …/position` (or opting out) deletes their row.
   Don't hand-delete `race_milestones`, because it is what stops duplicate pushes.
6. **Results.** With task 179 merged, `GET …/results` gives one finish time per runner,
   reconciled: Garmin activity > Strava activity > the live finish split. Synced runs land after
   the runners' watches sync, usually within hours. Check `deltaToLiveSec`: a gap of minutes means
   a watch was stopped late, so tell the runner before the time goes on a podium.
7. **2026-12-08:** turn `race_live` (and `race_live_phone`) off for the club.

---

## Reading the health API

`GET /api/health` is public and returns only ages and states (`docs/uptime-check.md`).

| field | race-day meaning | action |
|---|---|---|
| `status: ok` | all good | — |
| `status: degraded`, HTTP 200 | a job is late. On race morning, look at **which** check | below |
| `status: down`, HTTP **503** | all DB reads failed: the board and phone writes will fail too | rollback step 4 |
| `checks.db.state: down` | Supabase (or the service key) unreachable | Supabase status page. Rollback step 4 |
| `checks.cron_tick.state: stale` (> 20 min) | the Vercel 5-min tick stopped. Reminders and scheduled pushes are late. **The race poller does not depend on it** (GitHub Actions drives it) | `docs/runbook.md` → "A cron fails". Not a race stopper |
| `checks.garmin_sync` / `strava_sync: stale` | activity sync is behind. Post-race activities land late. Live tracking is unaffected | not a race stopper |

`/api/health` does **not** tell you whether the race poller is running. For that, read
`last_polled_at` in `GET /api/race-live/$EVENT_ID/config` (staff) and the `race-live`
workflow log. If the staff status API (#271) is merged, `GET /api/admin/status` (staff) adds
provider, cron, error and queue counts. Use it for "are pushes failing" (`errors24h`) and
"is something overdue" (`queues`).

---

## Rollback steps (smallest first)

1. **One runner is wrong** (bad split, wrong bib): enter the right time again (it overwrites), or fix
   the entry with `PUT …/entries`. If a runner wants out: opt them out. Their row disappears from
   the board and their position and link are deleted at once.
2. **Pushes misbehave** (duplicates, wrong copy): `PUT …/config {"pushEnabled":false}`. The
   board keeps working and milestones are still claimed silently, so turning it back on won't
   flood old milestones.
3. **The live feature misbehaves** (wrong positions, someone visible who shouldn't be):
   `PUT …/config {"active":false}`. Every position disappears from the board immediately and
   writes stop. Then turn `race_live` off for the club (the board answers `{enabled:false}` and the
   tab shows its pre-race content). Staff can still enter times, which keeps results.
4. **The app or DB is down** (`/api/health` `down`, the board 500s, or the board answers `degraded: "error"` steadily):
   - Supabase down: nothing in the app can fix it. Fall back to the official Maratón Valencia app
     and post results in the club group by hand. Turn `pushEnabled` off when the DB is back, so the
     backlog of entries doesn't push hours late.
   - A bad deploy (it broke after a release): **(owner)** Vercel → Deployments → the previous
     production deployment → *Instant Rollback*. Or move `production` back: run the daily-release
     workflow with an approval of the previous commit. Don't push to `production` by hand on race day.
5. **The poller is the problem** (a runaway or failing tick, a Garmin `error:refused`): cancel the
   `race-live` workflow run. Manual entry keeps working without it, and staff typing times is the
   race-day plan anyway. Without the poller there are no LiveTrack positions and no 24 h purge
   until it runs again.

**Never on race day:** run a migration, flip `cron_paused`, delete `race_milestones` or
`cron_tick_locks` rows, or approve a release.
