# Architecture

How a request moves through MadregotConnect, where identity is checked, how runs get in, how a
run is graded against the plan, and how features are switched on. Every section links to the code
that is the source of truth — when this page and the code disagree, the code wins and this page
needs a fix. `CLAUDE.md` holds the rules (week anchors, timestamps, security posture); this page is
the map.

## 1. Request flow

```
browser / PWA / native app
   │  JWT in Authorization (apiHeaders / bearerHeaders, src/lib/api.ts)
   ▼
src/proxy.ts                  ── /api/*: passes through, except on the dev surface (dev-api-allowlist)
   │                             pages: sets NEXT_LOCALE=he on first visit
   ▼
src/app/api/**/route.ts       ── thin handler: gate → validate → Supabase (service role) → JSON
   │                             withServerTiming (src/lib/perf/server-timing.ts) on hot GETs
   ▼
src/lib/**                    ── the logic; routes call into it
   ▼
Supabase Postgres             ── createServerClient (src/lib/supabase/server.ts), service role, RLS bypassed
```

- **Pages** are client components under `src/app/(app)/` (signed-in shell, `layout.tsx` gates on
  the client session) and the public pages at the root (`page.tsx`, `login`, `join/[token]`, …).
- **API routes** follow the shape in CLAUDE.md "API conventions": `NextResponse.json`, `{ error }`
  on failure, fixed text on 500 (`src/lib/api-error.ts`).
- **The service worker** (`src/app/sw.ts`) caches pages and static assets; `/api/*` is
  NetworkOnly, so an API answer is never served stale from the SW. Client-side data caching is
  SWR + `swr-persist`, scoped to `APP_VERSION` (`src/lib/version.ts`).
- **Shared server cache** for data that is the same for every member only:
  `src/lib/cache/shared.ts` (program weeks, events, club updates). Never personal data.
- **Dev surface**: on the dev Supabase project / dev branches, `src/lib/dev-api-allowlist.ts`
  404s every API route that is not explicitly listed (fail closed). Production is never the dev
  surface.

## 2. Auth gates

Identity is derived server-side from the Supabase JWT. The full per-route list is
`docs/route-auth-inventory.md`, held to the code by `src/__tests__/routeAuthInventory.test.ts`
(a new ungated route fails CI unless it is added to the public allowlist with a reason).

| Gate | File | Admits |
|---|---|---|
| `requireSession` | `src/lib/auth-session.ts` | any signed-in user; returns the verified athlete/role |
| `resolveVerifiedCaller` + `mayActFor` | `src/lib/auth/self-or-staff.ts` | self or staff |
| `requireMember` | `src/lib/auth/self-or-staff.ts` | any verified club member |
| `requireStaff` / `requireStaffCaller` | `src/lib/auth/self-or-staff.ts` | admin / coach |
| `requireCallerForAthlete` | `src/lib/auth/self-or-staff.ts` | self, staff, or that trainee's academy coach |
| `requirePackLeader` | `src/lib/auth/self-or-staff.ts` | a pack leader for that pack |
| `CRON_SECRET` bearer | each `src/app/api/cron/*/route.ts` | Vercel cron / GitHub Actions |
| device token | `src/app/api/device/*` | a paired watch/device |
| token in URL | `join/*`, signed photo URLs | the holder of an unguessable, single-purpose token |

Roles live on `athletes.role` (`admin`, `coach`, `academy_coach`, `core_runner`, `runner`,
`viewer`); staff = `isStaffRole` in `src/lib/constants.ts`. Staff "view as" a runner is read-only
(`src/lib/impersonation.ts`). Nav visibility is data: `role_tab_permissions` /
`role_mobile_tab_permissions`, resolved only by `resolveNavItems` (`src/lib/nav-items.ts`).

Remaining non-JWT routes and the plan for them: CLAUDE.md "Security posture".

## 3. Sync pipeline (runs in)

```
GitHub Actions hourly / Vercel cron */5 02–21 UTC
   ▼
POST /api/cron/sync                       src/app/api/cron/sync/route.ts  (one 300 s deadline)
   ├─ Strava-only athletes, rotated      src/lib/strava/poll-rotation.ts
   ├─ Garmin pass, budgeted              src/app/api/garmin/sync-activities/route.ts (runSyncRequest)
   │     └─ per athlete: GarminService   src/lib/garmin/client.ts   → athlete_activities upsert
   │                    laps / streams    src/lib/garmin/laps.ts, streams.ts, executed-workout.ts
   ├─ weekly_km_snapshots                 (durable rollup; NOT a display source, CLAUDE.md)
   ├─ Strava avatar refresh, daily        src/lib/strava/avatar-refresh.ts
   └─ bonus history passes if time left   strava backfill-routes / backfill-laps, garmin history-schedule

Strava push: POST /api/strava/webhook    src/app/api/strava/webhook/route.ts  (fast 200, sync in after())
```

- **Both providers, one run**: Garmin's copy wins, by upgrade — CLAUDE.md "When both providers have
  the same run"; dedup in `src/lib/activity-dedup.ts`.
- **Timestamps** are wall clock stored UTC-shaped — never convert (CLAUDE.md).
- **A new activity row creates its feed item** in the database (trigger, migration 047); the feed
  projection is `src/lib/feed/project.ts` (`FEED_SELECT`, `maskHiddenStats`).
- **Weekly km** is bucketed from activities by `fetchWeeklyVolume`
  (`src/lib/athletes/weekly-volume.ts`; DB-side via `weekly_volume_buckets`, migration 206).
- **Timeouts** on every outbound call: `src/lib/http/timeout.ts` (PR #209, task 96 — not on main yet).
- Other crons (`vercel.json`): `tick` every 5 min (reminders, scheduled pushes, Sunday recap;
  overlap lock `cron_tick_locks`), `notifications` every minute, `badges`, `academy-report`,
  `workout-watch`, `detect`, `wellness`, `photos-mirror`. Pause switch: `src/lib/cron-pause.ts`.

## 4. Plans out (to the watch)

Coach uploads a plan (PDF/image, Hebrew RTL) → `src/lib/ai/parser.ts` (Claude, accuracy-critical,
CLAUDE.md "The AI parser") → coach review in `WorkoutEditor` → `weekly_plans` (athlete_id NULL =
group plan) → `POST /api/garmin/push-workouts` → `src/lib/garmin/converter.ts` (pace target only
for academy athletes) → Garmin workout + schedule. Delivery state: `src/lib/garmin/delivery.ts`.

## 5. Grading engines ("did they do the workout")

Four engines, each answering a different question (CLAUDE.md has the full table):

| Question | Engine |
|---|---|
| Distance / time covered? | `assessWorkout` — `src/lib/academy/adherence.ts` |
| Pace hit? | `gradePlanBlocks` — `src/lib/academy/execution.ts` |
| Reps done? | `findPlannedEfforts` — `src/lib/academy/segments.ts` |
| All of it, from the watch's own steps | `gradeWatchSteps` — `src/lib/academy/watch-steps.ts` |

The watch engine is evidence, the others inference, so it goes first. The feed badge combines them
in `src/lib/feed/plan-verdicts.ts` → `buildVerdict` (`src/lib/plan-execution/verdict.ts`); which
plan slot a run is graded against is `src/lib/plan-execution/run-match.ts` and `ran-lane.ts`;
warm-up/cool-down satellites are excluded by `src/lib/plan-execution/satellite.ts`. Tolerances come
from `academy_settings` (`src/lib/academy/settings-server.ts`). Lanes (which pack's version of the
plan) are resolved per day from pack history (`src/lib/groups/pack-history.ts`).

## 6. Feature flags

Two kinds:

1. **Rollout flags (owner-controlled, in the DB).** Keys and Hebrew labels in
   `src/lib/features/flags.ts` (`FEATURES`), rows in `feature_enablements` with scope
   `athlete | squad | academy | role | club` (narrowest wins, `SCOPE_RANK`), every change audited in
   `feature_enablement_audit`. Read with `isFeatureEnabled(key, athleteId)`
   (`src/lib/features/server.ts`); a missing table is "off". Public keys (`PUBLIC_FEATURE_KEYS`)
   are readable without a session via `/api/features/public`.
2. **Ops switches (env vars, default off)** for server behaviour that must not depend on the DB:
   e.g. `MC_OUTBOUND` (non-production send
   allowlist, `src/lib/outbound-policy.ts`), `EMAIL_TRANSPORT`, and (proposed in the round-4 PRs for tasks 100/101) `WEEKLY_VOLUME_CACHE`, `PROFILE_STAT_ROLLUPS`.

## 7. Outbound

| Channel | Code | Notes |
|---|---|---|
| Web push + APNs | `src/lib/push.ts`, `src/lib/apns.ts` | quiet hours `src/lib/notifications/quiet-hours.ts`; dead endpoints pruned |
| Email (Resend) | `src/lib/email/*` | transport switch, suppression, send budget |
| Garmin / Strava | `src/lib/garmin/*`, `src/lib/strava/*` | one shared Garmin credential per athlete, encrypted (`src/lib/encryption.ts`) |
| Anthropic | `src/lib/ai/parser.ts`, `src/lib/run-chat/*` | model IDs in CLAUDE.md "The AI parser" |

## 8. Schema

`supabase/migrations/NNN_*.sql` is the schema; `supabase/schema.sql` is the original and stale.
Migrations are pasted by hand in the Supabase SQL editor — nothing applies them automatically
(CLAUDE.md "Adding a DB column"). Routes that read a new column fall back when it is missing.
