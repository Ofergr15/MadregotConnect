// "השבוע שלי" on the profile's stats tab (Ofer, 2026-10-18, mockups/my-week/full.html):
// the PLAN week (Sunday–Saturday) by day, the same moment last week, and ten such weeks.
//
// One window for the whole card. The stats payload's other weekly numbers follow the
// athlete's own week-start setting (Monday by default, the watch's week), which is what
// put "131.6 / 24–30" on screen: last activity week's kilometres against the new plan
// week's target. Everything here is cut on the plan's Sunday so the ring, the days and
// the target can only ever be about one week.
//
// Pure: `nowWall` is Israel's wall clock as a UTC instant (Convention A, lib/utils.ts —
// an activity's start_time already holds the athlete's local time in its UTC parts), so
// the answer is the same on the server and in any viewer's timezone.

import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';

const DAY_MS = 86_400_000;
const WEEKS = 10;

export interface PlanWeekRun { id: string | null; km: number; seconds: number; start: string }

export interface PlanWeekStats {
  /** This plan week's Sunday, YYYY-MM-DD. */
  weekStart: string;
  /** Index of today in the week, 0 = Sunday. */
  today: number;
  km: number;
  runs: number;
  seconds: number;
  /** Kilometres per day, Sunday first. */
  days: number[];
  /** The runs behind each day, for the day sheet. */
  dayRuns: PlanWeekRun[][];
  /** Last week from its Sunday up to this same weekday and minute. */
  lastWeekSoFar: number;
  /** Last week's kilometres per day, Sunday first — the home's "השבוע שעבר" (2026-10-19). */
  lastDays: number[];
  /** The runs behind each of last week's days. */
  lastDayRuns: PlanWeekRun[][];
  /** Ten plan weeks, oldest first, this one last (so far). */
  weeks: Array<{ weekStart: string; km: number }>;
  /** Mean of the nine full weeks before this one. */
  avgKm: number;
}

const instant = (startTime: string) => {
  const s = startTime.trim().replace(' ', 'T');
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`).getTime();
};
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Israel's wall clock now, as the UTC instant Convention-A timestamps compare against. */
export function israelWallNow(date: Date = new Date()): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? 0 : parts.hour), Number(parts.minute), Number(parts.second));
}

export function buildPlanWeek<T extends RunActivityRow>(acts: T[], nowWall: number): PlanWeekStats {
  const now = new Date(nowWall);
  const today = now.getUTCDay();
  const sunday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - today * DAY_MS;
  const first = sunday - (WEEKS - 1) * 7 * DAY_MS;
  const lastSunday = sunday - 7 * DAY_MS;
  const sameMomentLastWeek = nowWall - 7 * DAY_MS;

  const weekKm = new Array<number>(WEEKS).fill(0);
  const days = new Array<number>(7).fill(0);
  const dayRuns: PlanWeekRun[][] = Array.from({ length: 7 }, () => []);
  const lastDays = new Array<number>(7).fill(0);
  const lastDayRuns: PlanWeekRun[][] = Array.from({ length: 7 }, () => []);
  let runs = 0;
  let seconds = 0;
  let lastWeekSoFar = 0;

  for (const a of filterQualifyingRuns(acts)) {
    const t = instant(a.start_time);
    if (t < first || t > nowWall) continue;
    const km = a.distance / 1000;
    const w = Math.floor((t - first) / (7 * DAY_MS));
    if (w >= 0 && w < WEEKS) weekKm[w] += km;
    if (t >= sunday) {
      const d = Math.floor((t - sunday) / DAY_MS);
      days[d] += km;
      dayRuns[d].push({ id: a.id ?? null, km: r1(km), seconds: a.duration, start: a.start_time });
      runs++;
      seconds += a.duration;
    } else if (t >= lastSunday) {
      const d = Math.floor((t - lastSunday) / DAY_MS);
      lastDays[d] += km;
      lastDayRuns[d].push({ id: a.id ?? null, km: r1(km), seconds: a.duration, start: a.start_time });
      if (t <= sameMomentLastWeek) lastWeekSoFar += km;
    }
  }
  for (const list of [...dayRuns, ...lastDayRuns]) list.sort((x, y) => instant(x.start) - instant(y.start));

  const full = weekKm.slice(0, WEEKS - 1);
  return {
    weekStart: dayKey(sunday),
    today,
    km: r1(days.reduce((s, x) => s + x, 0)),
    runs,
    seconds,
    days: days.map(r1),
    dayRuns,
    lastWeekSoFar: r1(lastWeekSoFar),
    lastDays: lastDays.map(r1),
    lastDayRuns,
    weeks: weekKm.map((km, i) => ({ weekStart: dayKey(first + i * 7 * DAY_MS), km: r1(km) })),
    avgKm: Math.round(full.reduce((s, x) => s + x, 0) / full.length),
  };
}
