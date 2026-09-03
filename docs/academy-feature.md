# Academy Feature — Design & Research

Status: **All phases (0–6) built and live** (migrations 019/020/021 applied).
This doc captures the design decisions and the codebase seams.

Progress:
- ✅ P0 migration `019_academy.sql` (is_academy, weekly_plans.athlete_id, tab perms) — commit c06a5ee
- ✅ P1 Academy tab + roster page (`/dashboard/academy`) — commit c06a5ee
- ✅ P2 pace-zone push for academy (`ConvertOptions.paceTarget`) — commit 0fb2e80
- ✅ P4 adherence engine (`src/lib/academy/adherence.ts` + `/api/academy/adherence`) — commit c96f872
- ✅ P5 in-app compliance view (`src/components/AcademyCompliance.tsx`) — commit c96f872
- ✅ P3 per-athlete plan authoring (`src/components/AcademyPlanComposer.tsx`, Plans tab;
  `POST /api/plans` accepts `athlete_id`, `GET` scopes group vs individual plans).
  The composer now LOADS the athlete's saved plan for the selected week for editing
  (not always blank).
- ✅ P6 weekly report email — SHIPPED (not deferred): `sendAcademyWeeklyReport` in
  email.ts (real nodemailer send), cron `/api/cron/academy-report`. The cron is
  pinged daily and gates the send on the coach-configured `report.day` (Israel
  weekday) and sends to the configured `report.recipients` (falls back to
  ADMIN_EMAIL). `?force=1`/`?weekStart=` bypass the day gate for testing.

Week convention: **Sunday-based** everywhere (plans save a Sunday `week_start_date`,
pushes date workouts as `week_start + dayOfWeek` with dayOfWeek 0=Sun). Adherence +
compliance UI + report all use Sunday weeks to match.

Post-migration TODO: verify end-to-end with a real academy athlete (mark academy →
build individual plan → push → after a run, check Compliance). GMAIL_APP_PASSWORD +
CRON_SECRET must be set for the weekly email.

## Workout builder + library (added after P0–6)
- Migration `020_academy_workouts.sql`: `academy_workouts` (coach_id, name, workout jsonb).
  **Also needs running in Supabase** (alongside 019).
- `/api/academy/workouts` — GET/POST/DELETE library of reusable single-workout templates
  (workout = ParsedWorkout JSON). GET returns [] if the table isn't migrated yet.
- Plans tab (`AcademyPlanComposer`) reworked into 7 day-slots. Each slot can be filled by
  **Build** (opens the existing `WorkoutEditorPanel` — same structured editor + settings
  pace zones as the group planner) or **Library** (pick a saved workout). Building a workout
  auto-saves it to the library. Push saves an individual `weekly_plans` row (flat) + pushes
  all filled days to the athlete's Garmin in one call.
- Reuse note: `WorkoutEditorPanel` (src/components/WorkoutEditor.tsx) is the shared editor;
  only WeekView + AcademyPlanComposer use it. No new editor was written.

## Stats + benchmark results (added after builder)
Needs migration `021_benchmark_results.sql` run in Supabase (alongside 019, 020).

- **Academy Stats tab** (`AcademyStats` + `/api/academy/stats`): team totals + per-athlete
  workouts/km/time from real `athlete_activities`, week (Monday) + all-time toggle.
  Reuses the leaderboard Map-accumulate aggregation. Empty until academy athletes sync runs.
- **Benchmark results** (2000m time-trial etc.), name-based so it works for people not yet
  registered; `athlete_id` auto-links on exact name match:
  - `benchmark_results` table (migration 021); time helpers `src/lib/academy/benchmark.ts`
    (parseTime/formatTime, unit-tested); `/api/academy/benchmarks` GET/POST/DELETE.
  - **Academy Results tab** (`AcademyResults`): coach add/edit/delete results (the admin
    entry surface). **Races tab** (`BenchmarkLeaderboard`): public podium top-3 + full board.
    **Profile** (`ProfileBest`): the viewing athlete's result by athlete_id, name fallback.
  - **Import**: `scripts/import-benchmarks.mjs` loads `scripts/data/benchmark-2000m.csv`
    (42 rows exported from the shared Google Sheet, 2000m). Run AFTER migration 021:
    `node scripts/import-benchmarks.mjs` (add `--replace` to reset a test first).
    Only ~3 of 39 sheet names currently match registered athletes; the rest import unlinked
    and auto-link later when those people register with matching names.

## Goal

A dedicated **Academy** area to manage a separate class of "academy athletes" with a
higher-touch coaching model:

1. **Academy tab** — top-level section to manage academy athletes.
2. **Pace-zone Garmin push** — academy athletes get the OLD alerting model (specific pace
   pushed as a Garmin `pace.zone` target that beeps when off-pace), unlike regular club
   athletes who now get info-only pace text (commit `072cfe5`).
3. **Per-athlete individual plans** — each academy athlete can get a tailored weekly plan
   (regular athletes follow the shared group plan).
4. **Coach compliance view** — per academy athlete: how many sessions completed vs planned,
   and per-workout whether it was done "according to plan" (day / distance / duration / pace).
5. **Weekly report** — in-app dashboard first (recharts); emailed report is a later add-on.

## Decisions (locked)

| Question | Decision |
|---|---|
| Identify academy athletes | `is_academy BOOLEAN` flag on `athletes` (athlete can still be in a normal pace-group) |
| "Done according to plan" measures | ALL of: ran that day, distance vs planned, duration vs planned, pace vs planned (per-km splits) |
| Report delivery | In-app dashboard first (recharts); emailed weekly report deferred |
| Plan model | **Per-athlete individual plans** for academy athletes (new plumbing — see Phase 3) |

## Key structural facts (from research)

- **Single-coach app**: `COACH_ID` hard-coded in `src/lib/constants.ts:1`; most routes filter by it.
- **Plans are group-wide today**: `weekly_plans` (`coach_id`, `week_start_date`, `parsed_workouts` JSONB,
  `status`) has NO athlete owner. `workout_deliveries` is the only per-athlete link to a plan
  (one row per athlete per pushed workout, dated `week_start + dayOfWeek`, stores the full
  converted `GarminWorkout` JSON in `workout_data`).
- **Actuals already synced**: `athlete_activities` (per run: distance, duration, moving_duration,
  average_pace, average_hr, elevation, per-km `splits` JSONB) via nightly `cron/sync` →
  `sync-activities`. Plus `weekly_km_snapshots` (durable per-athlete-per-week rollup:
  distance_m, runs, duration_s) — **written but nothing reads it yet**.
- **No planned-vs-actual linkage exists.** Match key would be `athlete_id` + calendar date
  (`workout_deliveries.workout_date` ≈ `athlete_activities.start_time::date`).
- **Dormant asset**: `ActivityFeed.tsx` `PaceChart` already accepts a `planned` prop
  (green dashed planned-pace overlay) that is never passed — ready for adherence viz.
- **Charting**: hand-rolled SVG/bar patterns only. `recharts` was installed but never
  imported and has been removed; re-add it if a real chart is wanted.
- **Cron/email**: one cron (`vercel.json` → `cron/sync`, 03:00 UTC); `src/lib/email.ts`
  (nodemailer/Gmail) is transactional-only. `resend` installed but unused.

## Implementation phases

### Phase 0 — DB foundation (`supabase/migrations/019_academy.sql`)
- `ALTER TABLE athletes ADD COLUMN IF NOT EXISTS is_academy BOOLEAN NOT NULL DEFAULT false;`
- Per-athlete plans: `ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE;`
  (nullable — null = existing group-wide plan; set = individual academy plan). Keeps all
  current plans working unchanged.
- Seed `role_tab_permissions` + `role_mobile_tab_permissions` for `tab='academy'`
  (`ON CONFLICT (role,tab) DO NOTHING`, mirroring migrations 006/008/011).
- (Optional) an `academy_adherence` cache table if on-the-fly computation is too slow; start
  without it — compute in the API route from existing tables.

### Phase 1 — Academy tab + roster (thin slice, shippable)
- New page `src/app/dashboard/academy/page.tsx` (coach view: list academy athletes).
- Nav: add `{ href:'/dashboard/academy', tab:'academy', labelKey:'academy', icon:GraduationCap }`
  to `allNavItems` in `src/components/Header.tsx:12`.
- i18n: `nav.academy` in `messages/en.json` + `messages/he.json` (`"Academy"` / `"אקדמיה"`).
- Settings: add `{ key:'academy', label:'Academy' }` to `allTabs` in
  `src/app/dashboard/settings/page.tsx` so admins can toggle it.
- Roster: reuse `/api/athletes` (surface `is_academy` in the GET select at
  `src/app/api/athletes/route.ts:22`); add a way to mark an athlete academy (PUT `is_academy`).

### Phase 2 — Pace-zone push for academy (small, isolated)
- Thread an options arg through the converter:
  `convertToGarminWorkout(workout, paceProfile, opts?: { paceTarget?: boolean })` →
  `convertStep(step, paceProfile, stepOrder, opts)` in `src/lib/garmin/converter.ts`.
  When `opts.paceTarget` and `step.targetType === 'pace'`, restore the `pace.zone` block from
  commit `072cfe5` (`workoutTargetTypeId:6`, `targetValueOne/Two = paceToMetersPerSecond(...)`),
  KEEPING the description text too. Default (flag off) stays info-only — existing tests in
  `src/__tests__/converter.test.ts` stay green.
- Wire the single call site `src/app/api/garmin/push-workouts/route.ts:60`: pass
  `{ paceTarget: true }` when the target athlete `is_academy` (per-athlete decision inside the loop).
- Add converter tests for the `paceTarget:true` path (asserts `pace.zone` + `targetValueOne/Two`).

### Phase 3 — Per-athlete plans for academy
- Extend the planner (`src/app/dashboard/plan/new/page.tsx`) and `weekly_plans` writes to
  optionally target a single academy athlete (set `weekly_plans.athlete_id`).
- Push flow: an individual plan pushes only to that athlete; deliveries recorded as today.
- Keep group plans untouched (athlete_id null).

### Phase 4 — Compliance / adherence engine
- New route `src/app/api/academy/adherence/route.ts`: for a given academy athlete + week,
  join planned workouts (that athlete's `workout_deliveries` for the week, or their individual
  `weekly_plans`) to actual `athlete_activities` by date. Per planned session compute:
  - **completed?** = an activity exists on the planned date.
  - **distance** actual vs planned (planned km from steps — reuse `computeWorkoutDistance` in
    `src/app/api/dashboard/weekly/route.ts`), % diff + within-tolerance flag.
  - **duration** actual moving_duration vs planned total step duration.
  - **pace** actual average_pace / per-km `splits` vs planned target pace per step.
  - Roll up to a per-week "X of Y sessions done" + per-metric adherence score.
- Reuse `weekly_km_snapshots` for the actual weekly volume side (already group-aware, historical).

### Phase 5 — Academy coach dashboard + weekly report (in-app)
- Academy dashboard: per-athlete cards/table showing sessions done vs planned, adherence
  badges per workout, weekly volume vs plan. Follow the hand-rolled bar patterns in
  `dashboard/page.tsx` (there is no charting library in the project).
- Wire the dormant `PaceChart` `planned` prop in `src/components/ActivityFeed.tsx` to overlay
  planned pace on each academy activity.
- Weekly report = a summarized view of the above per week (drill-down by athlete).

### Phase 6 — Emailed weekly report ✅ SHIPPED
- `src/app/api/cron/academy-report/route.ts` renders the weekly report to HTML and emails
  it via `src/lib/email.ts` (`sendAcademyWeeklyReport`, nodemailer). `CRON_SECRET`-authed.
  Reports the previous completed week. Honors the coach's configured recipients + weekday
  (`AcademySettings.report`); pinged daily, sends only on the chosen day.

## Critical files (reference)
- Nav: `src/components/Header.tsx:12`; layout `src/app/dashboard/layout.tsx`
- Settings/permissions: `src/app/dashboard/settings/page.tsx`; `supabase/migrations/003,014`
- Athletes: `src/app/dashboard/athletes/page.tsx`; `src/app/api/athletes/route.ts`
- Converter/pace: `src/lib/garmin/converter.ts`, `src/lib/garmin/pace.ts`, `src/lib/garmin/types.ts`
- Push flow: `src/app/api/garmin/push-workouts/route.ts`; client `src/lib/garmin/client.ts`
- Planned data: `weekly_plans`, `workout_deliveries` (`supabase/schema.sql:50,61`); `src/lib/ai/types.ts`
- Actuals: `athlete_activities` (`schema.sql:74`), `weekly_km_snapshots` (mig 017,
  `src/lib/weekly-snapshots.ts`); sync `src/app/api/garmin/sync-activities/route.ts`
- Aggregation helpers to reuse: `src/app/api/dashboard/weekly/route.ts`
  (`extractWorkouts`, `computeWorkoutDistance`, `getWorkoutType`)
- Adherence viz seam: `src/components/ActivityFeed.tsx` (`PaceChart` `planned` prop, `PlannedStep`)
- i18n: `messages/en.json`, `messages/he.json` (`nav` namespace)
