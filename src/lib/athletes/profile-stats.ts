import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { activityLocalDateStr, activityWeekStart, getActivityWeekStart, toISODate } from '@/lib/utils';

/**
 * Pure shaping for GET /api/athletes/[id]/stats — the peer-safe training
 * summary behind the unified athlete profile (one page, two viewers: the owner
 * and any other club member).
 *
 * It exists as its own module for two reasons:
 *  1. The three existing endpoints that produce this data — /api/athletes/summary,
 *     /volume-history and /prs — are all `mayActFor`-gated (own athlete, staff or
 *     super-user), so a normal member gets 403 on every one of them for a peer.
 *     The profile needs the same numbers under a `requireMember` gate, and the
 *     shaping is the part worth sharing rather than re-deriving.
 *  2. The km table's week-over-week delta and the pace-per-week column are real
 *     arithmetic with real edge cases (a zero week can't be a denominator, the
 *     first row has nothing to compare against), and those are far cheaper to
 *     pin in a unit test than through the DB.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface KmTableRow {
  weekStart: string;
  km: number;
  runs: number;
  /** Average moving pace for the week, seconds per km. Null for a zero week. */
  paceSecPerKm: number | null;
  /**
   * Percent change in km against the PRECEDING week in the returned window.
   * Null when there is no comparable previous week — either it's the oldest row,
   * or the previous week was a zero week (0 can't be a denominator; reporting
   * "+∞%" or a bare "+100%" for 0→14 km would both be lies).
   */
  deltaPct: number | null;
  /** The week the athlete is standing in right now — the table highlights it. */
  isCurrent: boolean;
}

/**
 * The km table: the `limit` weeks ending with the one the athlete is standing
 * in, oldest first, each with its week-over-week delta.
 *
 * ── WHY THIS BUCKETS ACTIVITIES RATHER THAN READING weekly_km_snapshots ──────
 * The snapshots table looked like the obvious source — it is precomputed and one
 * cheap query — but its `week_start` anchor CHANGED mid-history. Rows written
 * before ~2026-08-09 are anchored on Monday and rows after it on Sunday, so a
 * real athlete's ten most recent snapshots came back containing both 2026-08-09
 * (Sun) and 2026-08-10 (Mon) — two overlapping views of one week — plus a stray
 * zero row on 2026-08-17 sitting inside the 08-16 week. Rendered, that is a
 * ten-bar chart with two phantom columns, a fake rest week, and deltas measured
 * between weeks that overlap.
 *
 * Activities are the source of truth those snapshots are derived from, this
 * route already loads all of them for the all-time totals, and bucketing them
 * with `activityWeekStart` gives one Sunday-anchored week per column by
 * construction — and the same week boundary the trend badge and the leaderboards
 * use, so the three can't disagree. It also costs one fewer DB round trip.
 *
 * The window is GENERATED from the current week rather than read off the data,
 * so a week with no runs is a visible zero rather than a gap that silently
 * shortens the chart and makes a rest week invisible. The delta is computed
 * after the window is cut, so the oldest column has none: a delta against a
 * week the reader cannot see is worse than no delta.
 */
export function buildKmTable<T extends RunActivityRow>(
  acts: T[],
  opts: { limit?: number; currentWeekStart: string },
): KmTableRow[] {
  const limit = opts.limit ?? 10;

  const buckets = new Map<string, { meters: number; runs: number; seconds: number }>();
  for (const r of filterQualifyingRuns(acts)) {
    // Week keys come from the date STRING, never from an instant: `start_time`
    // is wall clock stored as UTC, and reading it as an instant shifts a 21:30
    // Saturday run into the next week.
    const wk = activityWeekStart(r.start_time);
    const b = buckets.get(wk) || { meters: 0, runs: 0, seconds: 0 };
    b.meters += r.distance;
    b.runs += 1;
    b.seconds += r.duration || 0;
    buckets.set(wk, b);
  }

  const keys: string[] = [];
  const cur = new Date(`${opts.currentWeekStart}T00:00:00`);
  for (let i = limit - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - i * 7);
    keys.push(toISODate(d));
  }

  return keys.map((weekStart, i) => {
    const b = buckets.get(weekStart);
    const km = round1((b?.meters || 0) / 1000);
    const durationSec = b?.seconds || 0;
    const prevKm = i > 0 ? round1((buckets.get(keys[i - 1])?.meters || 0) / 1000) : null;
    return {
      weekStart,
      km,
      runs: b?.runs || 0,
      paceSecPerKm: km > 0 && durationSec > 0 ? Math.round(durationSec / km) : null,
      deltaPct: prevKm && prevKm > 0 ? Math.round(((km - prevKm) / prevKm) * 100) : null,
      isCurrent: weekStart === opts.currentWeekStart,
    };
  });
}

export interface RecentRun {
  id: string | null;
  name: string | null;
  startTime: string;
  km: number;
  durationSec: number;
  paceSecPerKm: number | null;
}

/**
 * The "recent runs" list. Takes raw activity rows, keeps only what counts as a
 * run (the same `filterQualifyingRuns` the PR view and the badge engine use, so
 * a run that shows here is a run that could earn a badge), newest first.
 */
export function buildRecentRuns<T extends RunActivityRow>(acts: T[], limit = 10): RecentRun[] {
  return filterQualifyingRuns(acts)
    .slice()
    .sort((a, b) => b.start_time.localeCompare(a.start_time))
    .slice(0, limit)
    .map((r) => {
      const km = round1(r.distance / 1000);
      return {
        id: r.id ?? null,
        name: r.activity_name ?? null,
        startTime: r.start_time,
        km,
        durationSec: r.duration,
        paceSecPerKm: km > 0 ? Math.round(r.duration / km) : null,
      };
    });
}

export interface AllTimeTotals {
  totalKm: number;
  totalRuns: number;
  totalHours: number;
}

/**
 * All-time totals for the profile's stat trio. Distance is rounded to whole km
 * to match what /api/athletes/summary already reports on the owner's own
 * screens — the same athlete must not read 1,284 km on one page and 1,283.6 on
 * another.
 */
export function buildAllTimeTotals<T extends RunActivityRow>(acts: T[]): AllTimeTotals {
  const runs = filterQualifyingRuns(acts);
  let meters = 0;
  let seconds = 0;
  for (const r of runs) {
    meters += r.distance;
    seconds += r.duration || 0;
  }
  return {
    totalKm: Math.round(meters / 1000),
    totalRuns: runs.length,
    totalHours: round1(seconds / 3600),
  };
}

/**
 * This week's km/runs, read off the km table rather than bucketing the raw
 * activities a second time — so the headline number and the highlighted column
 * of the table are the same arithmetic and cannot drift apart. The table always
 * contains the current week (the window is generated, not found), so an athlete
 * who hasn't run yet gets an explicit `{ km: 0, runs: 0 }`.
 */
export function pickWeek(table: KmTableRow[], weekStart: string): { km: number; runs: number } {
  const row = table.find((r) => r.weekStart === weekStart);
  return { km: row?.km ?? 0, runs: row?.runs ?? 0 };
}

/**
 * "Am I ahead of last week?" — this week's kilometres so far against the SAME
 * slice of last week.
 *
 * Carried over from WeeklyVolumeCard (which this profile replaced), comment and
 * all, because the naive version of this badge is wrong six days out of seven:
 * comparing a Monday's one day against last week's full seven reads "−80%" every
 * single week until Saturday night, and a number that is negative almost always
 * is not a signal. So last week is truncated to the weekday the athlete is
 * standing on.
 *
 * Null when there is nothing honest to compare against — a week with no runs has
 * no percentage, and "+∞%" is not a badge.
 *
 * Dates are compared as DATE STRINGS via `activityLocalDateStr`, never as
 * instants: `start_time` is wall clock stored as UTC, so `new Date(...)` shifts
 * it +3h in Israel and drops a late-evening run on the wrong side of the cutoff.
 * `activityWeekStart` is used for the same reason — the local-getter version
 * jumps a 21:30 Saturday run into the next week.
 */
export function computeLikeForLikeTrend<T extends RunActivityRow>(
  acts: T[],
  anchor: Date,
): number | null {
  const runs = filterQualifyingRuns(acts);
  const daysElapsed = anchor.getDay() + 1; // Sun → 1 … Sat → 7
  const thisKey = getActivityWeekStart(anchor);

  const prevStart = new Date(`${thisKey}T00:00:00`);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevKey = getActivityWeekStart(prevStart);
  const prevCutoff = new Date(prevStart);
  prevCutoff.setDate(prevCutoff.getDate() + daysElapsed);
  const prevCutoffKey = toISODate(prevCutoff);

  let thisSoFar = 0;
  let prevSoFar = 0;
  for (const r of runs) {
    const wk = activityWeekStart(r.start_time);
    if (wk === thisKey) thisSoFar += r.distance;
    else if (wk === prevKey && activityLocalDateStr(r.start_time) < prevCutoffKey) prevSoFar += r.distance;
  }

  if (prevSoFar <= 0) return null;
  return Math.round(((thisSoFar - prevSoFar) / prevSoFar) * 100);
}
