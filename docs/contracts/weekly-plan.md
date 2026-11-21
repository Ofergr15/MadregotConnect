# Weekly plan: server contract for the native client (plan H3)

Tests: `src/__tests__/weeklyPlanContract.test.ts`. All reads need a session (`Authorization: Bearer <Supabase JWT>`), else 401.

## `GET /api/plans/week?weekStart=YYYY-MM-DD[&lane=mine]`
- **`weekStart` must be the Sunday** of the plan week. It is matched literally, so a Monday key returns `hasPlan: false`.
  Activity weeks (leaderboards, km) start Monday. Do not reuse that key here.
- Bad or missing `weekStart` → 400 `{ error: "weekStart (YYYY-MM-DD) is required" }` (auth is checked first).
- No plan → `{ hasPlan:false, hasClubPlan:false, weekStart, dailyDistances:[], sessions:[], typeDistribution:{}, weekTotalMin:0, weekTotalMax:0, trainingDays:0 }`.
  It never returns another week's plan.
- Plan → `{ hasPlan:true, hasClubPlan:true, weekStart, publishedAt, lane, ownPlan, dailyDistances[7], sessions, typeDistribution, weekTotalMin/Max, weekRequiredMin/Max, trainingDays }`.
  - `dailyDistances[i].dayOfWeek`: 0 = Sunday. Date = `weekStart + dayOfWeek`. Compare dates, never weekdays.
  - `publishedAt` = `created_at` only when status is `pushed`. For `partial` (sent, some pushes failed) it is `null`.
  - `ownPlan: true` = the caller's personal academy week (`athlete_id` = me), not the club plan (`athlete_id` NULL).
- `lane=mine` → the caller's pace lane of the club week (`lane` 1–3). An own academy plan is returned as is.
- Day-only sessions can produce `hasPlan:true, hasClubPlan:false`.

### Which row wins for a week
1. Your own personal row beats the club row, whatever the status. It stops counting once you leave the academy (`is_academy:false`), unless it is a manual week.
2. Within the same kind, `pushed` beats everything else.
3. Another athlete's personal row is never served.
4. An academy-only trainee (no club group) gets only their own rows.

### Known gaps (pinned as "KNOWN GAP")
- **Drafts are never shown to a runner** (since 2026-11-20): draft rows are dropped before the week's row is
  picked, so a draft-only week is `hasPlan: false` and a draft can't beat a sent `partial` week. Staff still see drafts.
- `publishedAt` is set only for `pushed`; a runner's `partial` week has `publishedAt: null`.

## `GET /api/dashboard/weekly`
- Same selection rules and the same breakdown fields, for the **displayed** week: `currentWeekStart` (Sunday).
  It rolls to the next Sunday after Saturday 20:00 Israel time.
- Also returns `hasPlan`, `hasClubPlan`, `publishedAt`, `weekDelta`, `prevWeekTotal`, `weeklyVolumes`, `longRunProgression`.
- Cached for 300 s server-side.

## `GET /api/plans/weeks` → `{ weekStarts: string[] }`
- Distinct weeks, newest first.
- Known gap: it includes draft-only weeks and weeks that only hold another athlete's personal row.
  Treat it as "weeks that may have a plan". Ask `/plans/week` for each one.

`GET /api/plans` (raw rows) is staff-only: 403 for a runner.
