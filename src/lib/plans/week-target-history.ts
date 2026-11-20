import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import { weekTargetRange, type WeekTarget } from '@/lib/plans/week-target';

/**
 * The target band for a LIST of past weeks, each computed from its own plan.
 *
 * The volume chart needed this because a single band drawn across twelve weeks
 * is a lie in a club whose plan changes every week: a 78 km week can sit under
 * the current 101–120 band and look like a miss when the plan that week asked
 * for 70–85 and the athlete was on it. Nothing extra had to be stored — every
 * week already keeps its own `weekly_plans` row with its own `parsed_workouts`,
 * so the band is recoverable per week from the plan the athlete actually had.
 *
 * Weeks with no plan row, or a row that was never parsed into structured
 * workouts, come back absent rather than borrowing a neighbour's band. The chart
 * then draws no zone over them, which is the truth: there is no target on record
 * for that week.
 */
/** The plan read failed: the targets are UNKNOWN, which is not the same as "no plan that week". */
export class WeekTargetsUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'WeekTargetsUnavailable'; }
}

export async function fetchWeekTargets(
  supabase: { from: (t: string) => any },
  coachId: string,
  weekStarts: string[],
): Promise<Map<string, WeekTarget>> {
  const out = new Map<string, WeekTarget>();
  if (weekStarts.length === 0) return out;

  const { data, error } = await supabase
    .from('weekly_plans')
    .select('week_start_date, parsed_workouts, status')
    .eq('coach_id', coachId)
    .in('week_start_date', weekStarts);
  // A failed read used to come back as an empty map, which a chart draws as "no target on record"
  // for every week. Throwing lets the caller say the targets are unavailable instead.
  if (error) throw new WeekTargetsUnavailable(String((error as { message?: string }).message ?? error));

  // A week can hold more than one row (a draft alongside the pushed version).
  // The pushed one is what the athletes were actually given, so it wins — the
  // same precedence `/api/plans/week` uses.
  const chosen = new Map<string, any>();
  for (const row of data || []) {
    const prev = chosen.get(row.week_start_date);
    if (!prev || (row.status === 'pushed' && prev.status !== 'pushed')) chosen.set(row.week_start_date, row);
  }

  for (const [weekStart, row] of chosen) {
    const breakdown = buildWeekBreakdown(row.parsed_workouts);
    const target = weekTargetRange({ hasPlan: true, ...breakdown });
    if (target) out.set(weekStart, target);
  }
  return out;
}
