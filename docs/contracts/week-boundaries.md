# Week boundaries: what each native screen's numbers mean

Two anchors on purpose (CLAUDE.md "Week starts — TWO anchors"; authority `src/lib/utils.ts`):

| Screen / route | Week | Anchor | Evidence |
|---|---|---|---|
| Today + weekly plan: `GET /api/dashboard/weekly` (`currentWeekStart`, `dailyDistances[0]` = Sunday) | **Plan week** | Sunday, rolls forward after Saturday 20:00 Israel | `today.md`, `weeklyDashboardContract.test.ts` |
| Squad standings `GET /api/groups/standings` (`weekStart`) | **Activity week** | Monday, Israel calendar day (`israelDateAnchor`) | `groups/standings/route.ts:51-52` |
| Leaderboard `GET /api/groups/leaderboard` (`weekStart`, `monthStart`) | **Activity week** | Monday, Israel calendar day | `groups/leaderboard/route.ts:66-69` |

Native rules:
- Never compare a plan-week key with an activity-week key; they never match and silently read 0.
- `athlete_activities.start_time` is the athlete's wall clock stored as UTC. Filters compare it against
  `YYYY-MM-DD` (UTC midnight = the athlete's local midnight), which is correct. Display it **in UTC**, never
  converted to the phone's timezone.
- The plan-week roll-forward means Saturday after 20:00 the Today screen already shows next week while
  standings still show the running activity week (Monday→Sunday). Both are right.
- Find "today" in the plan by date (`weekStart + dayOfWeek`), not by weekday.

Audit result: both standings routes use the activity week and the Israel day consistently; no mismatch found.
