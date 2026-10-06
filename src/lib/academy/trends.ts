// The weekly series behind the academy home's chart: how many trainees there were
// at the end of each plan week (and how many of them joined that week), how much
// of the plan they did, and how far they ran. Pure: the route reads, this counts.
//
// "Trainees in week W" counts today's academy members whose academy_joined_on is
// on or before the end of W. Someone who left the academy is not in today's list,
// so the series shows joining, not leaving; a member with no join date (before
// migration 077 stamped one) counts from the start.

export interface TrendWeek {
  /** The plan week's Sunday, YYYY-MM-DD. */
  weekStart: string;
  trainees: number;
  joined: number;
  km: number;
  runs: number;
  /** Done ÷ planned for that week, null when nothing was planned. */
  completionRate: number | null;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The `count` plan weeks ending with `lastWeekStart`, oldest first. */
export function trendWeeks(lastWeekStart: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(lastWeekStart, -7 * (count - 1 - i)));
}

export function buildTrend({
  weeks,
  members,
  runs,
  adherence,
}: {
  weeks: string[];
  members: Array<{ joinedOn: string | null }>;
  /** One per run: the plan week it falls in, and its distance in metres. */
  runs: Array<{ weekStart: string; meters: number }>;
  /** Per plan week: summed planned and completed workouts. */
  adherence: Map<string, { planned: number; completed: number }>;
}): TrendWeek[] {
  return weeks.map((weekStart) => {
    const end = addDays(weekStart, 6);
    const inWeek = runs.filter((r) => r.weekStart === weekStart);
    const a = adherence.get(weekStart);
    return {
      weekStart,
      trainees: members.filter((m) => !m.joinedOn || m.joinedOn <= end).length,
      joined: members.filter((m) => !!m.joinedOn && m.joinedOn >= weekStart && m.joinedOn <= end).length,
      km: Math.round(inWeek.reduce((s, r) => s + r.meters, 0) / 1000),
      runs: inWeek.length,
      completionRate: a && a.planned > 0 ? Math.min(1, a.completed / a.planned) : null,
    };
  });
}
