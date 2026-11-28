import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { RUNS_ONLY_OR } from '@/lib/activities/kinds';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { addDaysToDateStr, getActivityWeekStart, israelDateAnchor } from '@/lib/utils';
import { LAST_RUN_LOOKBACK_DAYS, lastRunDays, notRunThisWeek, type GroupFilter, type NotRunResult } from './not-run';

type Db = ReturnType<typeof createServerClient>;

/**
 * The reads behind "who hasn't run" — shared by the list and the message dry run so the
 * two can never name different people. Throws on any failed read: an empty list would
 * read as "everyone ran".
 */
export async function loadNotRun(db: Db, filter: GroupFilter, now: Date = new Date()): Promise<NotRunResult> {
  const weekStart = getActivityWeekStart(israelDateAnchor(now));
  const weekEnd = addDaysToDateStr(weekStart, 7);
  const lookback = addDaysToDateStr(weekStart, -LAST_RUN_LOOKBACK_DAYS);
  const [members, groups, runs] = await Promise.all([
    db.from('athletes').select('id, name, group_id').eq('coach_id', COACH_ID).eq('status', 'active').or('role.is.null,role.neq.admin'),
    db.from('groups').select('id, name').eq('coach_id', COACH_ID),
    // start_time is the runner's wall clock in a UTC-shaped column (CLAUDE.md): compare in the same terms.
    fetchAllRows<{ athlete_id: string; start_time: string }>((from, to) => db.from('athlete_activities')
      .select('athlete_id, start_time').gte('start_time', `${lookback}T00:00:00Z`).lt('start_time', `${weekEnd}T00:00:00Z`)
      .or(RUNS_ONLY_OR).range(from, to)),
  ]);
  if (members.error) throw members.error;
  if (groups.error) throw groups.error;
  const ranThisWeek = runs.filter((r) => String(r.start_time).slice(0, 10) >= weekStart).map((r) => r.athlete_id);
  return notRunThisWeek(
    weekStart,
    ((members.data ?? []) as Array<{ id: string; name: string | null; group_id: string | null }>).map((m) => ({ id: m.id, name: m.name, groupId: m.group_id })),
    (groups.data ?? []) as Array<{ id: string; name: string | null }>,
    ranThisWeek,
    lastRunDays(runs),
    filter,
  );
}
