# Today screen (plan H1): server contract for the native client

Test: `weeklyDashboardContract.test.ts`. `GET /api/dashboard/weekly` with `Authorization: Bearer`.
No session → 401. Returns the club plan, or the caller's own personal/academy week; never
another trainee's. Plan reads are server-cached for up to 300 s.

## Response (200)
`{ currentWeekStart, hasPlan, hasClubPlan, publishedAt, dailyDistances, sessions, weekTotalMin,
weekTotalMax, weekDelta, prevWeekTotal, trainingDays, typeDistribution, weeklyVolumes, longRunProgression }`
- `currentWeekStart`: `YYYY-MM-DD`, always a **Sunday** (plan week, not the Monday activity week
  used for km and leaderboards).
- `dailyDistances`: always 7 entries, `dayOfWeek` 0 (Sun) to 6. Each `{ day, dayOfWeek, min, max,
  requiredMin, requiredMax, type, sessions: [{ min, max, type, name, optional }] }` (km).
- `sessions`: every session of the week in run order: `{ key, dayOfWeek, name, type, kind, partIndex,
  partCount, optional, kmMin, kmMax, kmFrom, durationSec, steps, daySession? }`.
- `hasPlan: false` means no plan for this week, and everything is zeroed or empty. Show "no plan
  yet", not a rest week. The route never substitutes another week's plan. `hasClubPlan`: a real
  weekly plan exists (as opposed to only one-day sessions).
- `publishedAt`: the plan's `created_at` only when its status is `pushed`, else `null`.
- `weekDelta`: % against the previous week's plan; 0 when there was no previous plan. **With no
  plan this week but one last week it is -100**, so hide the delta when `hasPlan` is false.
- `weeklyVolumes` `[{ week, volume, weekNum }]` / `longRunProgression` `[{ week, distance }]`:
  up to the last 20 planned weeks, ascending.
- 500 `{ error: "Failed to fetch weekly data" }`.

## Which week, and which day is "today"
- The week rolls forward at **Saturday 20:00 Israel wall-clock** (UTC+2 winter, UTC+3 summer):
  from then on `currentWeekStart` is tomorrow's Sunday, so athletes can preview.
- So never compare `dayOfWeek` with the device's weekday. A day's date is
  `currentWeekStart + dayOfWeek` (UTC date arithmetic); today's session is the day whose date equals
  today's Israel date. On Saturday evening no entry is today.
- `prevWeekTotal`/`weekDelta` compare against the week before the **displayed** week.
