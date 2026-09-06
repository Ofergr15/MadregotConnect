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
| `npm run lint` | next lint (5 pre-existing `exhaustive-deps` warnings, 0 errors) |
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
