// Weekly summary comparisons (task 184), on the ACTIVITY week (Monday–Sunday) — the same week the
// summary card, the Sunday recap push and the athlete's watch count (lib/week-story/summary.ts).
//
// Two questions the card didn't answer:
// - "How did my week compare to my group's?" — my km against my group's average and median, my
//   place among the group's runners who ran, and every group's average side by side.
// - "Am I trending up?" — this week against my own last four weeks.
//
// Only aggregates of other people leave here: no teammate's name or km. Pure; loadWeekCompare
// (compare-server.ts) feeds it.
import { addDays } from './model';

export interface CompareRun { athleteId: string; day: string; km: number }
export interface GroupInfo { id: string; name: string }

export interface TrendWeek { weekStart: string; km: number; runs: number }

export interface WeekTrend {
  /** Oldest first: the four weeks before, then this week (5 entries). */
  weeks: TrendWeek[];
  /** Mean km of the four previous weeks, counting a zero week as zero. Null when all four were empty. */
  avg4Km: number | null;
  deltaKm: number | null;
  /** (this − avg4) / avg4, rounded to a whole percent. */
  deltaPct: number | null;
  /** ±10% of the four-week average counts as steady. */
  direction: 'up' | 'down' | 'steady' | null;
}

export interface GroupStat {
  groupId: string;
  name: string;
  /** Active members of the group. */
  members: number;
  /** Members who logged at least one run this week. */
  runners: number;
  /** Mean / median km over `runners` (not members: a rest week elsewhere shouldn't drag me up the table). */
  avgKm: number;
  medianKm: number;
}

export interface MyGroup extends GroupStat {
  myKm: number;
  /** 1-based among `runners`; null when I didn't run. */
  myRank: number | null;
  /** (myKm − avgKm) / avgKm as a whole percent; null when nobody ran. */
  vsAvgPct: number | null;
}

export interface WeekCompare {
  weekStart: string;
  weekEnd: string;
  trend: WeekTrend;
  group: MyGroup | null;
  groups: GroupStat[];
}

/** A group's comparison is withheld below this many runners: with two, "the average" is one person's km. */
export const MIN_GROUP_RUNNERS = 3;
const STEADY = 0.1;

const r1 = (n: number) => Math.round(n * 10) / 10;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** `runs` must include the caller's runs from four weeks before `weekStart` through its Sunday. */
export function buildTrend(weekStart: string, myRuns: Array<{ day: string; km: number }>): WeekTrend {
  const weeks: TrendWeek[] = [-4, -3, -2, -1, 0].map((i) => {
    const start = addDays(weekStart, 7 * i);
    const end = addDays(start, 6);
    const rs = myRuns.filter((r) => r.day >= start && r.day <= end);
    return { weekStart: start, km: r1(rs.reduce((s, r) => s + r.km, 0)), runs: rs.length };
  });
  const prev = weeks.slice(0, 4);
  const now = weeks[4].km;
  if (prev.every((w) => w.km === 0)) return { weeks, avg4Km: null, deltaKm: null, deltaPct: null, direction: null };
  const avg = prev.reduce((s, w) => s + w.km, 0) / 4;
  const ratio = (now - avg) / avg;
  return {
    weeks,
    avg4Km: r1(avg),
    deltaKm: r1(now - avg),
    deltaPct: Math.round(ratio * 100),
    direction: ratio > STEADY ? 'up' : ratio < -STEADY ? 'down' : 'steady',
  };
}

/**
 * Per-group stats for the week. `memberGroup` maps every active member to their group; runs of
 * anyone not in it (inactive, no group) are ignored. Groups below MIN_GROUP_RUNNERS are left out.
 */
export function buildGroupStats(
  weekStart: string, runs: CompareRun[], memberGroup: ReadonlyMap<string, string>, groups: readonly GroupInfo[],
): { stats: GroupStat[]; kmOf: Map<string, number> } {
  const end = addDays(weekStart, 6);
  const kmOf = new Map<string, number>();
  for (const r of runs) {
    if (r.day < weekStart || r.day > end || !memberGroup.has(r.athleteId)) continue;
    kmOf.set(r.athleteId, (kmOf.get(r.athleteId) || 0) + r.km);
  }
  const stats: GroupStat[] = [];
  for (const g of groups) {
    const ids = [...memberGroup.entries()].filter(([, gid]) => gid === g.id).map(([id]) => id);
    const kms = ids.map((id) => kmOf.get(id) || 0).filter((k) => k > 0);
    if (kms.length < MIN_GROUP_RUNNERS) continue;
    stats.push({
      groupId: g.id, name: g.name, members: ids.length, runners: kms.length,
      avgKm: r1(kms.reduce((s, k) => s + k, 0) / kms.length), medianKm: r1(median(kms)),
    });
  }
  return { stats, kmOf };
}

export function buildWeekCompare(opts: {
  weekStart: string;
  athleteId: string;
  myRuns: Array<{ day: string; km: number }>;
  clubRuns: CompareRun[];
  memberGroup: ReadonlyMap<string, string>;
  groups: readonly GroupInfo[];
}): WeekCompare {
  const { weekStart, athleteId } = opts;
  const { stats, kmOf } = buildGroupStats(weekStart, opts.clubRuns, opts.memberGroup, opts.groups);
  const myGroupId = opts.memberGroup.get(athleteId) ?? null;
  const mine = myGroupId ? stats.find((s) => s.groupId === myGroupId) ?? null : null;
  let group: MyGroup | null = null;
  if (mine) {
    const myKm = kmOf.get(athleteId) || 0;
    const ahead = [...opts.memberGroup.entries()]
      .filter(([id, gid]) => gid === myGroupId && id !== athleteId && (kmOf.get(id) || 0) > myKm).length;
    group = {
      ...mine,
      myKm: r1(myKm),
      myRank: myKm > 0 ? ahead + 1 : null,
      vsAvgPct: mine.avgKm > 0 ? Math.round(((myKm - mine.avgKm) / mine.avgKm) * 100) : null,
    };
  }
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    trend: buildTrend(weekStart, opts.myRuns),
    group,
    groups: [...stats].sort((a, b) => a.name.localeCompare(b.name, 'he')),
  };
}
