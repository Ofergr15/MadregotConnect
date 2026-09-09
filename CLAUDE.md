# CLAUDE.md — MadregotConnect

Guidance for Claude Code working in this repo.

> The `CLAUDE.md` in the home directory is about **Kibana** and is irrelevant here.
> This file wins for anything under `MadregotConnect/`.

## What this is

A Next.js 16 app for the Madregot running club. A coach pastes or uploads a weekly
training plan (usually a **Hebrew RTL PDF/image table**); Claude parses it into
structured workouts; the coach reviews/edits; the app pushes them to athletes'
**Garmin** watches. It also syncs completed activities back from Garmin/Strava to
drive dashboards, leaderboards, and academy compliance reporting.

Single-club, single-coach app. Hebrew is the default locale.

## Setup — read this first

**Node 22 is required.** Not a preference:

```bash
nvm use            # reads .nvmrc → Node 22
npm install
npm run check      # typecheck + tests + lint
```

On Node 20.18 the install *appears* to succeed but the test suite dies with
`Cannot find module './rolldown-binding.darwin-arm64.node'`. Cause: vitest 4's
native rolldown binding declares `engines: ^20.19.0 || >=22.12.0`, and npm
**silently skips** optional deps whose engines don't match. If tests suddenly
can't start, check `node -v` before anything else.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run check` | **Run before every commit** — typecheck + test + lint |
| `npm test` | vitest (120 tests, ~0.5s) |
| `npm run typecheck` | `tsc --noEmit` (~4s, currently clean) |
| `npm run lint` | next lint (3 pre-existing `exhaustive-deps` warnings, 0 errors) |
| `npm run build` | Production build (~40s) |

`npm run lint` warnings are pre-existing — don't treat them as your regression,
but don't add new ones.

## Architecture map

```
src/
  app/
    api/**/route.ts     ~45 REST routes (see "API conventions")
    (app)/              Signed-in shell (layout.tsx: auth gate, Header, tab bar)
      dashboard/**      Coach + athlete UI, all client components
      feed/             The feed — the app's landing page, served at /feed
    (auth pages)        page.tsx, login, join/[token], academy-register, …
  components/           Shared UI (WorkoutEditor, ActivityFeed, Academy*, …)
  lib/
    ai/                 Claude parser + prompt + types  ← accuracy-critical
    garmin/             Garmin client, workout converter, pace math
    academy/            Adherence, benchmarks, segments, weekly report
    supabase/           Clients + hand-written DB types
    utils.ts            cn(), week-start + activity-time helpers, group identity
  i18n/                 next-intl cookie-based locale
messages/{en,he}.json   1891 keys each, currently at parity
supabase/
  schema.sql            ⚠️ ORIGINAL schema only — stale
  migrations/0NN_*.sql  ⚠️ The real schema. Applied MANUALLY in the Supabase SQL editor.
```

### Data model (the parts that matter)

- **`athletes`** is the real user table. `coaches` exists but is mostly legacy — role
  resolution reads `athletes.role` first and only falls back to `coaches`.
  Roles: `admin`, `coach`, `academy_coach`, `core_runner`, `runner`, `viewer`.
- **`role_tab_permissions`** / **`role_mobile_tab_permissions`** drive nav visibility.
  Adding a dashboard tab means seeding both (see `025_academy_coach_role.sql` for the
  `ON CONFLICT (role, tab) DO NOTHING` pattern).
- **`weekly_plans`** — `athlete_id IS NULL` means a group-wide plan; set means an
  individual academy plan.
- **`athlete_activities`** — synced actuals. `weekly_km_snapshots` is a durable rollup.

### Week starts — TWO anchors, on purpose

This has caused real bugs in both directions. `src/lib/utils.ts` is the authority:

- **Plan week = Sunday.** `getPlanWeekStart()` / `planWeekStartOf()` —
  `weekly_plans.week_start_date`, workout dates (`week_start + dayOfWeek`, 0 = Sunday),
  adherence, academy reports, the feed card's weekly *target*.
- **Activity week = Monday**, since **2026-09-09**. `getActivityWeekStart()` (for a real
  calendar `Date`) and `activityWeekStart()` (for an `athlete_activities.start_time`
  string) — leaderboards, weekly km, volume charts, streaks, the weekly recap push.

They were merged onto Sunday on 2026-08-21 and **re-split on 2026-09-09**. Why the
re-split: a runner's watch said 180 km for the week and the app said 174.5 for the same
rows, and they reported it as a bug. Both figures were arithmetically correct — that is
precisely the problem. A weekly total nobody can reconcile against the device that
recorded it gets treated as broken, and the club plans in Sun–Sat while every watch
counts Mon–Sun, so the app now says both instead of picking one.

**The failure mode this creates is silent, not loud.** Comparing an activity-week key
against a plan-week value type-checks fine and simply never matches — the km read `0`.
Any screen that shows activity km next to plan content needs both, and there are three:
`api/academy/me`, `api/academy/members` (`weekStart` = plan, `kmWeek` =
`activityWeekOfPlanWeek(weekStart)`) and `api/feed/highlight` (`weekStart` = activity,
`planWeek` = plan, only the target reads the latter). `activityWeekOfPlanWeek()` picks
the Monday *inside* the plan week — six days of overlap, not one.

Two more things the anchor moves that a grep for the helper won't show: any
`getDay() + 1`-style "how far into the week are we" arithmetic (see `daysElapsed` in
`computeLikeForLikeTrend`), and any cron gated on a weekday. The Sunday 19:00 weekly
recap in `cron/tick` now recaps the week *closing that evening*, not the previous one.

The other trap: a plan day carries only a `dayOfWeek`, and the week
`/api/dashboard/weekly` returns is **not always the week the browser is standing in**
(`getDisplayWeekStart` rolls forward after Saturday 20:00 Israel so athletes can
preview). Turn it into a date with `planDayKey(weekStart, dayOfWeek)` from
`src/lib/plans/workout-parsing.ts` and compare dates — never `d.dayOfWeek ===
new Date().getDay()`. That route also reports `hasPlan: false` for a week with no
plan rather than substituting another week's; check it before rendering anything.

### Activity timestamps are UTC-shaped, not UTC

`athlete_activities.start_time` holds Garmin's `startTimeLocal` (the athlete's wall
clock) in a `TIMESTAMPTZ` column, so Postgres reads it as UTC. Reading it in the
viewer's timezone double-shifts it. **Always** use the helpers in `src/lib/utils.ts`
(`formatActivityTime`, `activityLocalHour`, `activityLocalDateStr`, …) rather than
`new Date(...).toLocaleString()`.

### Group identity has one source of truth

`resolveGroup()` in `src/lib/utils.ts` maps a raw group name to index, display name,
level, and color. Two color schemes previously drifted apart by re-deriving this
inline — don't. Group 1 = green/fast, 2 = yellow/medium, 3 = orange/slow.

Coach pace notation: `3:30 (3:40) ((3:50))` — plain = Group 1, single brackets =
Group 2, double = Group 3.

### "Did they do the workout" — four engines, not one

A plan day is rarely one thing ("2 km easy, 20 km at 4:25, 8×15 s strides"), so several
separate questions get asked of it and none of them subsumes the others:

| Question | Engine | Evidence |
|---|---|---|
| Did they cover the distance / time? | `assessWorkout` (`academy/adherence.ts`) | the run's totals |
| Did they hit the pace they were asked to run? | `gradePlanBlocks` (`academy/execution.ts`) | a distance/time trace |
| Did they do the reps? | `findPlannedEfforts` (`academy/segments.ts`) | the watch's laps |
| All of it, when a workout drove the watch | `gradeWatchSteps` (`academy/watch-steps.ts`) | the device's own step list + stamped laps |

**The fourth one is evidence where the others are inference, so it goes first** — the
feed badge and the segments route both prefer it and fall back automatically. It only
answers for a run the athlete started as a structured workout (~15% of runs, but that's
the club's quality sessions), and it needs *both* halves to come from the device:

- `athlete_activities.laps[].wktStepIndex` — the step Garmin says each lap was
  (`garmin/laps.ts`).
- `athlete_activities.executed_workout` — the step list that index points into,
  from `GET /activity/{id}/workouts` (`garmin/executed-workout.ts`, migration 095).
  Fetched on the sync when a lap is stamped; `?mode=stream` backfills history; the
  segments route fetches on demand for a run that has neither.

**Never read `wktStepIndex` against our own parsed plan.** It cost a real wrong verdict
twice: a repeat is a flat *marker* step that occupies an index and never runs, so
everything after the first set is numbered one too low (one athlete's Tuesday has three
markers mid-list); and athletes run workouts nobody pushed — one Sunday came off a
single open 22 km step where the club plan has a 2 km warm-up plus a 20 km block, every
index landed in range, and the verdict read "warm-up: 22 km".

**The pace target is usually prose.** 1 workout in 8 carries a machine `SPEED` target;
in the rest the coach writes it in the step's `notes`, in the same bracket notation as
the plan — so `stepPaceBand(step, lane)` runs it through `lanePaceFromNotes`
(`ai/splitGroups.ts`). Strip the notes and most steps stop being gradeable.

`dominantWatchStep()` mirrors `dominantBlock()` and both feed the same one-verdict rule,
so a run cannot pick up two answers. `report.complete` is the separate signal that a
step was never run — the athlete who abandoned a ladder at rep 5 still has an on-target
rep 4, and only the distance row says the session didn't happen.

**A run cut short still gets an answer, from the watch only.** Both functions above skip
a step or block the athlete didn't finish, which on a run that stopped mid-session skips
everything — and that left the club's most obvious defect: a dashed accuracy ring with
the run's 4:45 average printed beside the 4:35 that was asked for and "no comparison" in
the next cell, on a run whose own watch had already marked the 10 km of block it did get
through as on target. So `partialWatchStep()` is consulted **after** both come back empty
(in `resolveDominantPace`), and only from the device's step list — never from the block
search, whose truncated window is "everything from the cursor to wherever the run ended"
rather than a stretch anything named. It answers only for a step that was at least a
third of what it asked for and at least half of what the athlete ran (a stride set is
neither), and it always travels with `paceScope.truncated`, which the card turns into
"that pace is for Run 20km — the 10 km of 20 km you got through". Grading a fragment is
safe *because* distance and duration are two of the three metrics and both collapse on a
short run: the pace can lift the score, never carry it.

**Pace is never the whole-run average.** `assessWorkout`'s pace row only means
anything when one band covers ≥90% of the plan (`computeGradedPaceBand`), and even
then it's wrong for the shape above — the average of a warm-up plus a block is neither
number. `gradePlanBlocks` lays the plan's blocks out on the distance axis and *searches*
for the window of each block's planned length that best fits its band, forward of the
previous block and within a bounded drift (a longer warm-up is a real story; starting
the session 8 km in is not). Three constraints in there each exist because production
data broke without them — an unbounded search located a 2 km warm-up in the jog home,
reps merged across their recoveries into one long "block", and a warm-up written at
session pace became the headline verdict. Don't relax them without re-running a replay.

**A stream's clock is not the watch's clock.** `activity_streams.series.t` runs from
the first sample to the last including every pause, while Garmin's `duration` and
`average_pace` exclude them — measured across one day's 16 streamed runs the gap was
0 to 882 s. `traceFromStream` therefore compresses any sample gap of ≥5 s that covered
≤2 m out of the time axis, which reproduced Garmin's own duration to within a few
seconds on 14 of those 16. This is not cosmetic: three athletes stopped for 97-228 s at
22 km, between the block and the strides, and that pause falls *inside* the 20 km
block's window — so before the fix two of them were told they missed a 4:25 target that
their own lap press puts at 4:23. If a block's pace ever disagrees with the laps for the
same stretch, suspect the time axis first.

- `dominantBlock()` picks the one block a single verdict is about: longest, excluding
  warm-ups, cool-downs, ungraded and truncated blocks. **Both** the feed badge and the
  segments route go through it — the same run must not get two verdicts.
- The trace must start at metre 0. Garmin's first sample sits at 1-3 m, and
  `timeArriving`/`timeLeaving` return null below `d[0]` — which silently killed every
  block verdict on a run that fell far short of the plan, because those are the runs
  where the search has no slack and every window is pinned to the start.
- Reps are not blocks. A 5-minute rep is the rep finder's business, matched by
  *duration* for a timed step (`matchBy`), because a 15 s stride converted to metres
  through its target pace mis-measures anyone who ran it off pace.
- Read stored laps through `normalizeStoredLaps` (`garmin/laps.ts`), never straight off
  the jsonb. Three writers have filled that column (`duration` / `movingDuration` /
  Strava's `moving_time`), and a reader that knows only Garmin's key returns
  zero-duration laps — indistinguishable from a run with no markers.

### When both providers have the same run, Garmin's copy wins — by upgrade

Garmin auto-exports to Strava, so one run arrives twice, and the two copies are not
equivalent: Garmin's carries per-lap `wktStepIndex`, `executed_workout` and a 1 Hz
trace, Strava's carries none of the three. `activity-dedup.ts` is source-blind and
symmetric, so whichever sync ran first used to win permanently — and when Strava won,
the run was stuck with the copy no engine above can read properly. Measured: one
athlete's Tuesday double scored **74** with all six 2 km blocks marked `slower`
(248 s/km, 247, 248, 242, 246, 268) while his own laps put them at 3:34, 3:35, 3:30,
3:30, 3:25, 3:37 — five of six exactly on target — because a 45-point lap trace makes
`bestWindow` land on lap boundaries and swallow a 522 m recovery jog. The teammate who
ran the same session off Garmin scored 100. The segments route's self-repair can't heal
it either: `wantsStamps` needs `garmin_workout_id != null`, which a Strava row never has.

So `garmin/sync-activities` **upgrades the Strava row in place** (`findCrossSourceDuplicate`
returns the row, not a boolean). Four rules there are load-bearing, and
`garminStravaUpgrade.test.ts` pins them:

- **It is an UPDATE, never delete-and-reinsert.** The row id is referenced by kudos,
  comments, feedback, plan matches and `activity_streams`.
- **Upgrade-only: nulls are dropped from the patch.** Garmin's row shape uses null for
  "not reported", so writing it would erase what Strava had — `calories` is the live
  case (Garmin's list row never has it, Strava's detail endpoint does). Empty
  `gps_points` is the same claim and travels with `has_polyline`, or a failed detail
  fetch blanks a map the feed is drawing.
- **`activity_name` and `shoe_id` are never touched.** The name is user-editable
  (`PATCH /api/feed/items/[id]`), and `active_shoe_id` is the shoe they're wearing
  *now*, not for a run from last week.
- **`strava_activity_id` stays.** It is what keeps the Strava sync recognising the run
  so it doesn't insert a second copy — which is also why `needsStravaEnrich`
  (`lib/strava/enrich.ts`) refuses a row whose `source` is no longer `strava`:
  enrichment writes `laps: <Strava laps>` and would undo the upgrade silently.

Nothing about an upgrade notifies (the athlete already heard about this run) and it
doesn't count in `synced`; it's reported as `upgraded` and capped at 5 per athlete per
sync, since each is 2-4 serial Garmin calls under the 300 s ceiling. Strava-only runs
still exist and are still kept — this only ever fires when Garmin has the same run.

### Weekly km comes from the activities, not from `weekly_km_snapshots`

**Nothing displays that table, and nothing should start.** Only the current and previous
week are ever re-snapshotted, so every anchor change leaves the older rows behind. The
Monday→Sunday move on 2026-08-21 left 255 of 359 production rows Monday-keyed and 95
carrying `runs: 0`; the 2026-09-09 re-split back to Monday adds a **third** regime, so
the table now holds a Monday history, three Sunday-keyed weeks in the middle, and
Monday again after — with no column saying which. An axis built from the distinct
`week_start` values present therefore mixes anchors — eight columns for six weeks, three
overlapping their neighbour by six days — and one athlete's steady 175-185 km/week
rendered as
`179.3  72.3  52.2  177.8  0  182.7  174.5  93.3`, two collapses and a rest week they
never took, on the screen a coach uses to judge who is overtrained.

`lib/athletes/weekly-volume.ts` (`fetchWeeklyVolume`) is the one source now, used by
`/api/coach/volume` and `/api/athletes/volume-history`; `profile-stats.ts`'s
`buildKmTable` already did the same thing for the same reason. Two things there are not
optional: the axis is **generated** from the current week backwards (a collected axis
turns a rest week into a missing column), and it **pages** — Supabase caps a select at
1000 rows and reports the truncation as success, while the 25-athlete roster is 2772
activities over 26 weeks and 807 over the 8-week default.

## API conventions

Routes are thin handlers in `src/app/api/**/route.ts`. The established shape:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';   // any route reading live DB state
// export const maxDuration = 300;        // only for slow routes (AI parse, cron sync)

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // ... validate required params → 400
    const supabase = createServerClient();
    const { data, error } = await supabase.from('x').select('*');
    if (error) return NextResponse.json({ error: '...', details: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('...', error);
    return NextResponse.json({ error: error.message || '...' }, { status: 500 });
  }
}
```

Notes:
- `createServerClient()` uses the **service-role key and bypasses RLS**. Nearly every
  route uses it. `createServerClientWithAuth()` (anon key + cookies, respects RLS) exists
  but is essentially unused.
- Add `export const dynamic = 'force-dynamic'` to routes that read live data, or Next
  will statically cache them.
- Routes that touch a column added by an unapplied migration often **fall back** to an
  unscoped query so the app keeps working pre-migration (see `GET /api/plans`). Follow
  that pattern when adding columns.

### ⚠️ Security posture — know this before touching auth

**Most API routes are not authenticated.** They run as service-role and trust
caller-supplied identity from the request body or query string (`coach_id`, `email`,
`approverEmail`). Supabase auth is otherwise used **client-side only**, and the
dashboard layout gates on `localStorage` + a client session check.

Practically: **for those routes, any caller can hit any endpoint as anyone.** Role
gates (`canApprove`, `canGrantAdmin` in `src/lib/constants.ts`) are enforced against
an email the *client* supplied, so they're a UI guardrail, not a security boundary.

This is a known, deliberate state for a small private club app — don't silently
"fix" it as a side effect of another task. But **do not add new endpoints that
widen it** (e.g. deletion or role mutation driven purely by a body field), and flag
it if the app's exposure changes. A real fix means verifying the Supabase JWT
server-side and deriving identity from it.

**The personal-data read routes are the exception, and they're already fixed.** The
ten routes listed in `src/__tests__/verifiedRouteIdentity.test.ts` (athlete PRs,
badges, heatmap, volume, summary, challenges, activities, activity details, Garmin
details, `auth/me`) resolve identity from the Supabase JWT via the gates in
`src/lib/auth/self-or-staff.ts` — all of which funnel through `resolveVerifiedCaller`.
`x-user-email` is gone and that test fails if any route under `app/api/` reads it
back. Client callers send the JWT with `apiHeaders()` / `bearerHeaders()`
(`src/lib/api.ts`). Pick the narrowest gate that fits: `mayActFor` (self-or-staff),
`requireMember` (any verified club member), `requireStaff`.

Recorded exposure change, **2026-09-03**: `GET /api/activities/details` moved from
self-or-staff to `requireMember`, so tapping a teammate's run in the feed opens the
same detail the runner sees. The response is a full GPS trace — where someone lives
and when they were out — and that is now club-visible by product decision. It must
never become public.

Recorded exposure change, **2026-09-05**: `GET /api/join/groups?token=…` now also
returns that invite's own athlete (`name`, `email`, `groupId`, `garminConnected`) so
`/join/{token}` can stop asking an already-connected member for their Garmin password.
The invite token is the credential — unguessable, one row, delivered to that person's
inbox, and the same route already let its holder overwrite those fields. No new caller
gains anything, but it is the first read of athlete PII on that endpoint: keep it
token-scoped, and `garminConnected` stays a boolean (the credential is encrypted at
rest and must never be serialised).

**That related gap is now closed (2026-09-05):** `feed_items.payload.hiddenFields` (set
in the share sheet) is enforced in `maskHiddenStats` inside `src/lib/feed/project.ts` —
`calories` / `heart_rate` (both avg and max) / `pace` are blanked before the item leaves
the server, for every viewer including the athlete themselves. `power` is in the key
list but has no column yet, so it's a no-op until one lands. The masking lives in the
projection, not in `FeedCard`, so the share sheet's story image and
`/api/feed/items/[id]` get it too and no client can read the value out of the network
response. Covered by `src/__tests__/feedProject.test.ts`.

The feed now also ships `paceBands` — the per-km average paces from the cached
`splits` jsonb, as bare numbers — so a card's thumbnail can draw the pace heat map.
It is masked by the same `pace` key: hiding pace nulls the bands too, because per-km
paces are pace at a finer grain and would hand back the average the athlete just hid,
visibly in the colours and exactly in the JSON. If you add anything else derived from
`splits` to the feed, mask it the same way.

Recorded exposure change, **2026-09-06**: the plan verdict now reaches every athlete
for their OWN runs, on the feed card and the run detail — the academy compliance table
only ever answered "did this match the plan" for the one athlete flagged `is_academy`
while the other 25 got a plan pushed to their watch and no feedback.

It carries an accuracy **percentage**, and that is what sets its exposure: a score on a
named person, legible at a glance and comparable between teammates. So it is
**self-or-staff**, not member-visible — the spec was "the ring appears only on that
person's own workouts; staff see everything".

- `GET /api/academy/segments?verdict=1` is self-or-staff, **enforced by omission**:
  a caller who may not read it gets `verdict: null`, not a 403. That matters because the
  activity detail asks for `bands=1&verdict=1` in one request, so refusing would take
  the chart overlay — planned band + actual pace line, club training content any member
  may see — down with the score. `verdict: null` is a state the caller already renders;
  it's what a day with no plan returns. The omission short-circuits before the activity
  read and the lap match, so it costs nothing either. The per-segment default mode (a
  rep-by-rep pace readout) stays a hard 403. Pinned by
  `src/__tests__/academySegmentsVerdictRoute.test.ts`.
- The feed's rings are resolved server-side in `src/lib/feed/plan-verdicts.ts`, which
  grades **for the viewer**: rows that are neither the viewer's own nor readable as
  staff are skipped before scoring, so a teammate's number never enters the response to
  leak from. That is also the cheap path — a member's 20-card page grades the ~2 rows
  that are theirs. Pinned by `src/__tests__/feedPlanVerdicts.test.ts`.
- Then masked again under the existing `pace` hidden-field key
  (`project.ts:323`): hiding pace drops the ring outright rather than shipping a version
  computed from distance alone, since "off the target band" is a pace disclosure at a
  coarser grain.

If you add a new plan-derived label to the feed, mask it under `pace` too.

Same date, the verdict's pace stopped being the whole-run average and became a **block
average over a named stretch of the run**: `verdict.paceScope` (`label`, `fromM`/`toM`,
`plannedLengthM`, `ranLengthM`, `truncated`, `resolutionM`, `source: 'watch' | 'stream' |
'laps'`), with the run's own average kept beside it as `verdict.wholeRunPace` — a bare
number, and only set when it differs from the pace row, so nothing has to compare two
figures to find out whether it is the same one. Both are rendered: the pace row of the
accuracy card carries a line saying which stretch it is about, because an unlabelled 4:35
on a run the athlete's watch says averaged 4:45 reads as a broken app. See "four engines"
above for how the stretch is chosen.
`FEED_SELECT` in `src/lib/feed/project.ts` reads `laps` for the same reason the verdict
does; it is consumed server-side to build the trace and **never reaches the client**, so
keep it out of the projected item.

Still the same date, `?verdict=1` gained **`blocks`**, **`efforts`** and **`watchSteps`** —
the plan's blocks laid on the distance axis, the reps found in the laps, and the device's
own step list graded step by step (`gradeWatchSteps`). None of the three is trimmed for
the viewer, and none needs to be: they are only reachable inside the same `emitVerdict`
gate as the score, which is self-or-staff. **The gate is the enforcement point, not a
per-field trim** — an earlier draft trimmed `actualPace`/`averageHR` out of `watchSteps`
for a teammate, which was dead code behind a gate no teammate passes, and reading it as
live protection is how a future change ends up shipping the whole thing member-visible
by loosening the gate instead. If you ever do make a verdict field member-visible, note
that a step can be a 45-second stride, so its pace is finer than the per-km splits
members already see, and per-step HR is a new class outright (the feed masks HR under its
own key).

Because the watch path now runs first, the feed badge's `paceStatus` may be the verdict
on **a step shorter than a kilometre**. It is still a status and never a number, and
still masked under the existing `pace` key, so nothing new leaves the server — but do
not "improve" the badge by shipping the step's pace alongside it.

Recorded exposure change, **2026-09-07** — the first one that is about the *device*
rather than the API. `src/lib/swr-persist.ts` persists the SWR cache to
**localStorage** (`mc_swr_cache_v1`), so club data now **rests on the phone between
sessions**: whatever GETs the app made through `useApi` — this member's runs and paces,
the feed they can see, teammate names. Nothing new is disclosed to anyone (it is the
same data that session had already fetched and rendered), but "already on screen" and
"still on disk tomorrow" are different risks, so three rules in that file are
load-bearing rather than tidy, and are pinned by `src/__tests__/swrPersist.test.ts`:

- **Scoped to one identity** (`athlete_id`/`coach_email`) and refused *and deleted* when
  it doesn't match — the club shares phones and one iPad, and painting the previous
  person's kilometres is the failure this prevents.
- **Wiped on sign-out**, from `clearIdentityKeys()` rather than `signOutEverywhere()`,
  because `clearLocalIdentity()` before a new Strava/Google sign-in is the path that
  actually happens.
- **Scoped to `APP_VERSION`**, so a changed response shape can't be restored into a
  screen that no longer understands it — that failure has no failing request to explain
  the blank card.

Only `data` is restored, never a persisted `error` or `isValidating`. It is a cache, not
a store: don't put anything in it the API doesn't already hand this session. If you add
a route whose response should never touch disk, it needs an explicit skip in `save()` —
there is no allowlist today.

## The AI parser — the accuracy-critical path

`src/lib/ai/parser.ts` + `prompt.ts`. Two tiers:

| Input | Path | Model |
|---|---|---|
| Image / PDF | Claude vision | `claude-opus-4-8`, adaptive thinking, `effort: 'low'` |
| Text | Regex first (free), Claude on failure | `claude-haiku-4-5-20251001` |

Both model IDs are current and valid. The API shape is correct for Opus 4.8:
`thinking: { type: 'adaptive' }` + `output_config: { effort }`. On this model family
`budget_tokens` and `temperature`/`top_p`/`top_k` return **400** — don't add them.

**`effort: 'low'` is a deliberate latency choice, not a quality oversight.** Default
`high` pushed dense 3-column Hebrew plans past Vercel's 300s ceiling (hard 504).
Low keeps adaptive thinking on so pace ladders still read correctly. If a ladder is
ever misread, bump to `'medium'` before anything else.

Guardrails worth knowing before you touch this:
- The coach's **notes are the source of truth for pace**. `paceFromNotes()` re-derives
  the Group 1 pace from the notes and overwrites the model's number when they disagree.
- `validateAndFixStep()` repairs distance-vs-time misclassification using Hebrew and
  English unit regexes. The unit guards exist because an earlier version turned every
  "50 דקות" long run into 3000 m.
- `extractJson()` is a brace-counting, string-aware extractor — the model occasionally
  wraps JSON in fences or adds a stray sentence.
- One automatic retry on parse failure with a "return only JSON" nudge.

These behaviors are covered by tests (`src/__tests__/`). **If you change the parser or
prompt, run `npm test` — that suite is the regression net for plan-parsing accuracy.**

Known latent issue: the vision call is non-streaming at `max_tokens: 24000`. The
Anthropic SDK guidance is to stream above ~16K to avoid HTTP timeouts. Streaming would
also give better failure behavior against the 300s ceiling.

## Garmin integration

Unofficial API via the `garmin-connect` package — no official partner API, so it can
break when Garmin changes things. Tokens live encrypted in `athletes.garmin_auth`.

`src/lib/garmin/converter.ts` maps parsed workouts to Garmin's step DTOs. One flag
matters: `ConvertOptions.paceTarget`.

- **Off (default, club athletes):** pace is info-only text — no watch alerts.
- **On (academy athletes):** emits a Garmin `pace.zone` target — the watch beeps when
  the runner drifts off pace.

Set per-athlete from `is_academy` in `POST /api/garmin/push-workouts`.

## Scheduled work

| Job | Trigger | Notes |
|---|---|---|
| Activity sync | GitHub Actions hourly → `POST /api/cron/sync` | Vercel Hobby crons cap at once/day, hence Actions |
| Activity sync | Vercel cron 03:00 UTC → same route | |
| Academy report | Vercel cron Mon 05:00 UTC → `/api/cron/academy-report` | |

All gated by `Authorization: Bearer $CRON_SECRET`. `cron/sync` runs Garmin and Strava
via `Promise.allSettled` so one provider failing doesn't block the other, then writes
`weekly_km_snapshots`.

## i18n

`next-intl`, cookie-based (`NEXT_LOCALE`), **Hebrew default**, no locale in the URL.
`messages/en.json` and `messages/he.json` are at 1891 keys each — keep them in sync;
adding a key to one and not the other is the common mistake.

Adoption is partial: 14 of 44 components use `useTranslations`. Several (notably the
Academy components and `WorkoutEditor`) have hardcoded Hebrew. New user-facing strings
should go through `useTranslations`.

## Working in this repo

**Before committing:** `npm run check`.

**Adding a dashboard tab:** nav item in `src/components/Header.tsx` → `allTabs` in
`src/app/dashboard/settings/page.tsx` → `nav.*` key in both message files → seed
`role_tab_permissions` + `role_mobile_tab_permissions` in a new migration.

**Adding a DB column:** new numbered migration in `supabase/migrations/`. It must be
run **manually in the Supabase SQL editor** — there's no migration runner, and nothing
in CI or deploy applies them. Use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`, and
consider a graceful fallback in any route that reads the new column.

**Hotspots** (by churn — expect these to be messy and change often):
`dashboard/page.tsx` (1352 lines), `dashboard/settings/page.tsx` (1398),
`dashboard/plan/new/page.tsx` (1642), `components/Header.tsx`, `components/ActivityFeed.tsx`.

**Performance note:** `/dashboard` ships 117 kB of page JS (233 kB first load) as a
single client component — the heaviest route by far. Worth splitting if you're
already working in there.

**Docs:** `docs/academy-feature.md` is a genuinely useful design doc with a
file-by-file seam map. `GROUPS_REDESIGN_SUMMARY.md` covers the pace-offset group model.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
