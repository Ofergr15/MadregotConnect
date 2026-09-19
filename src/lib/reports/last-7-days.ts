import { israelToday, addDaysToDateStr } from '@/lib/utils';

/**
 * "The last 7 days" — the rolling window behind the Saturday 18:00 push and the
 * card on the profile.
 *
 * ROLLING, not the calendar week, and that is the whole point. The club's activity
 * week runs Mon–Sun (see `getActivityWeekStart`), so a report sent on Saturday
 * evening against the calendar week would be missing Sunday — the last day of the
 * very week it claims to summarise. A trailing seven days ending today is complete
 * on whatever day it is sent, which is what makes 18:00 on a Saturday a legal send
 * time at all. It also means this number and the leaderboard's "this week" are
 * deliberately different windows; they are answering different questions.
 *
 * One buckets-per-day fold, in ISRAEL days: a run that starts at 22:30 Israel is
 * 19:30 UTC, and bucketing on the UTC date would file Friday night's run under
 * Friday for an athlete whose watch says Saturday.
 */

/** The activity shape this needs — a subset of what the stats route already reads. */
export interface ReportActivity {
  activity_type?: string | null;
  start_time: string;
  distance: number | null;
  duration: number | null;
}

export interface ReportDay {
  /** YYYY-MM-DD, Israel. */
  date: string;
  /** 0 = Sunday, matching `israelNow().weekday` and the app's other day arrays. */
  weekday: number;
  km: number;
  seconds: number;
  runs: number;
}

export interface Last7Report {
  /** Oldest first — RTL lays the first one out on the right, which is the order a
   *  Hebrew reader expects, and LTR gets the same array unreversed. */
  days: ReportDay[];
  /** Inclusive window bounds, Israel dates. */
  from: string;
  to: string;
  km: number;
  seconds: number;
  runs: number;
  /** Distance-weighted seconds per km — null when nothing was run. */
  paceSeconds: number | null;
}

/**
 * Runs only, and the same list the weekly recap has always used, so the card and
 * the push cannot disagree about what counts. A walk is not a week of running.
 */
export const REPORT_RUN_TYPES = [
  'running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run',
];

/** Israel's calendar date for an activity's start instant. */
export function israelDateOf(startTime: string): string {
  return israelToday(new Date(startTime));
}

/**
 * @param acts  any activities; anything outside the window, non-run or zero-distance
 *              is dropped here rather than by the caller
 * @param today the last day of the window, an Israel `YYYY-MM-DD`
 */
export function buildLast7Report(acts: ReportActivity[], today: string): Last7Report {
  const from = addDaysToDateStr(today, -6);
  const days: ReportDay[] = [];
  const byDate = new Map<string, ReportDay>();
  for (let i = 0; i < 7; i++) {
    const date = addDaysToDateStr(from, i);
    // Noon so the weekday cannot be dragged over a boundary by a timezone offset.
    const day: ReportDay = { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), km: 0, seconds: 0, runs: 0 };
    days.push(day);
    byDate.set(date, day);
  }

  for (const a of acts) {
    if (!(Number(a.distance) > 0)) continue;
    if (a.activity_type && !REPORT_RUN_TYPES.includes(a.activity_type)) continue;
    const day = byDate.get(israelDateOf(a.start_time));
    if (!day) continue;
    day.km += Number(a.distance) / 1000;
    day.seconds += Number(a.duration) || 0;
    day.runs += 1;
  }

  const km = days.reduce((a, d) => a + d.km, 0);
  const seconds = days.reduce((a, d) => a + d.seconds, 0);
  const runs = days.reduce((a, d) => a + d.runs, 0);
  return {
    days,
    from,
    to: today,
    km,
    seconds,
    runs,
    // Total time over total distance, never an average of per-run paces: a 3 km
    // jog and a 30 km long run do not get an equal vote in a weekly pace.
    paceSeconds: km > 0 && seconds > 0 ? seconds / km : null,
  };
}

/** Seconds per km as m:ss. */
export function formatReportPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Total seconds as h:mm — a week is hours, not a stopwatch. */
export function formatReportHours(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}`;
}

/** Nothing ran in the window: no card, and above all no push. */
export function reportIsEmpty(report: Last7Report): boolean {
  return report.runs === 0;
}
