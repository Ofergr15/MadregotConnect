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

### Week starts — both are Sunday now

This has caused real bugs. `src/lib/utils.ts` is the authority:

- **Plan week = Sunday.** `getPlanWeekStart()` — `weekly_plans.week_start_date`,
  workout dates (`week_start + dayOfWeek`, 0 = Sunday), adherence, academy reports.
- **Activity week = Sunday too**, since **2026-08-21**. `getActivityWeekStart()` —
  leaderboards and weekly km. It used to be Monday, to match how Garmin/Strava report
  weekly mileage; that was changed by product decision so an athlete's week lines up
  with the coach's plan week. Don't "restore" it from a stale doc — this one was the
  stale doc.

The trap that remains: a plan day carries only a `dayOfWeek`, and the week
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

Recorded exposure change, **2026-09-06**: the plan verdict — "did this run match the
day's plan" — is now member-visible on two surfaces, because the academy compliance
table only ever answered it for the one athlete flagged `is_academy` while the other
25 got a plan pushed to their watch and no feedback.

- `GET /api/academy/segments?verdict=1` (and `?bands=1`) is **member-visible**;
  the per-segment default mode stays self-or-staff. Labelling the comparison publishes
  no new class of data: the planned band and the actual pace line already sit on the
  same chart for any member. The one thing it *would* have added — a rep-by-rep pace
  readout of someone else's intervals — is trimmed to `paces: []` for anyone but the
  athlete and staff. The counts (`found`/`needed`) stay, because "did they do the
  session" is the same grain as the badge. Pinned by
  `src/__tests__/academySegmentsVerdictRoute.test.ts`.
- The feed card's plan badge is resolved server-side in `src/lib/feed/plan-verdicts.ts`
  and masked under the existing `pace` hidden-field key — hiding pace drops the badge
  outright rather than shipping a version computed from distance alone, since "slower
  than the target band" is a pace disclosure at a coarser grain. The athlete's own
  verdict is still on their run's detail page.

If you add a new plan-derived label to the feed, mask it under `pace` too.

Same date, the verdict's pace stopped being the whole-run average and became a **block
average over a named stretch of the run** (`verdict.pace.scope` = `fromM`/`toM`, with the
average kept beside it as `wholeRunPace`; see "four engines" above). No new exposure
class: a mean over 10 km is strictly coarser than the per-km splits already on that
run's chart and in the feed's `paceBands` for any member. The per-rep paces stay
trimmed — those are finer than splits. `FEED_SELECT` in `src/lib/feed/project.ts` now
reads `laps` for the same reason the verdict does; it is consumed server-side to build
the trace and **never reaches the client**, so keep it out of the projected item.

Still the same date, `?verdict=1` gained **`watchSteps`** — the device's own step list
graded step by step (`gradeWatchSteps`). Member-visible, but **trimmed for anyone but the
athlete and staff**: `actualPace`, `gradeAdjustedPace`, `averageHR` and `occurrences` are
stripped, leaving the planned band, the step's name and its status. The trim is not
symmetry with `paces: []` for its own sake — a step can be a 45-second stride, so its
pace is finer than the per-km splits members already see, and per-step HR would be a new
class outright (the feed masks HR under its own key). What survives the trim is the same
grain as the badge: which steps were asked for, and whether each was met.

Because the watch path now runs first, the feed badge's `paceStatus` may be the verdict
on **a step shorter than a kilometre**. It is still a status and never a number, and
still masked under the existing `pace` key, so nothing new leaves the server — but do
not "improve" the badge by shipping the step's pace alongside it.

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
