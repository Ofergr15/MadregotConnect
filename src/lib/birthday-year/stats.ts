import { PR_RUN_TYPES, UNMEASURED_RUN_TYPES, computeDistanceBests, type RunActivityRow } from '@/lib/prs/pr-buckets';

/**
 * "השנה שלך" — the year a member ran since their last birthday, for the birthday story
 * (mockup ~/.cache/madregot/birthday-year/mockup-v4.html). Pure: the server reads the rows,
 * this turns them into every number a slide shows, and the slides only format.
 *
 * Dates are the activity's own calendar day (`start_time` carries the athlete's local
 * clock in its UTC fields — see parseActivityInstant), so "a day with a run" is the day
 * the athlete would name.
 */

export interface YearActivityRow extends RunActivityRow {
  id: string;
  route_preview_hd?: Array<{ lat: number; lng: number }> | null;
  route_preview?: Array<{ lat: number; lng: number }> | null;
}

export interface YearBest { key: string; seconds: number; date: string; activityId: string | null }

export interface YearMoment {
  activityId: string;
  key: 'fm' | 'hm' | '10k' | '5k';
  name: string | null;
  date: string;
  km: number;
  seconds: number;
  route: Array<{ lat: number; lng: number }>;
}

export interface YearStats {
  from: string;
  to: string;
  totalDays: number;
  km: number;
  runs: number;
  hours: number;
  elevM: number;
  calories: number;
  runDates: string[];
  restDays: number;
  activeWeeks: number;
  totalWeeks: number;
  streak: { days: number; from: string; to: string } | null;
  months: Array<{ ym: string; km: number }>;
  bestMonth: { ym: string; km: number } | null;
  commonHour: number | null;
  before7: number;
  topWeekday: { day: number; runs: number } | null;
  doubleDays: number;
  over30: number;
  avgKm: number;
  outdoor: number;
  treadmill: number;
  longest: { km: number; date: string; name: string | null } | null;
  bests: YearBest[];
  moment: YearMoment | null;
}

const DAY = 86_400_000;
const dayOf = (startTime: string) => startTime.slice(0, 10);
const atNoon = (d: string) => new Date(`${d}T12:00:00Z`).getTime();
export const daysBetweenIso = (a: string, b: string) => Math.round((atNoon(b) - atNoon(a)) / DAY);
export const addDaysIso = (d: string, n: number) => new Date(atNoon(d) + n * DAY).toISOString().slice(0, 10);

/** The window: from the last birthday (inclusive) to the day before this one. */
export function yearWindow(birthday: string): { from: string; to: string } {
  const [y, m, d] = birthday.split('-').map(Number);
  const prev = new Date(Date.UTC(y - 1, m - 1, d, 12));
  return { from: prev.toISOString().slice(0, 10), to: addDaysIso(birthday, -1) };
}

function isRun(a: YearActivityRow): boolean {
  return a.distance > 0 && a.duration > 0 && (!a.activity_type || PR_RUN_TYPES.includes(a.activity_type));
}

export function computeYearStats(rows: YearActivityRow[], window: { from: string; to: string }): YearStats {
  const runs = rows
    .filter((a) => isRun(a) && dayOf(a.start_time) >= window.from && dayOf(a.start_time) <= window.to)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const totalDays = daysBetweenIso(window.from, window.to) + 1;
  const km = runs.reduce((s, a) => s + a.distance, 0) / 1000;
  const sec = runs.reduce((s, a) => s + a.duration, 0);

  // Days, weeks and the longest unbroken run of days.
  const perDay = new Map<string, number>();
  for (const a of runs) perDay.set(dayOf(a.start_time), (perDay.get(dayOf(a.start_time)) ?? 0) + 1);
  const runDates = [...perDay.keys()].sort();
  let streak: YearStats['streak'] = null;
  let curFrom = '';
  let cur = 0;
  for (let i = 0; i < runDates.length; i++) {
    cur = i > 0 && daysBetweenIso(runDates[i - 1], runDates[i]) === 1 ? cur + 1 : 1;
    if (cur === 1) curFrom = runDates[i];
    if (!streak || cur > streak.days) streak = { days: cur, from: curFrom, to: runDates[i] };
  }
  const weekOf = (d: string) => Math.floor(daysBetweenIso(window.from, d) / 7);
  const activeWeeks = new Set(runDates.map(weekOf)).size;

  // Kilometres per calendar month, every month the window touches.
  const months: YearStats['months'] = [];
  for (let d = window.from.slice(0, 7); d <= window.to.slice(0, 7);) {
    months.push({ ym: d, km: 0 });
    const [y, m] = d.split('-').map(Number);
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  for (const a of runs) {
    const mo = months.find((x) => x.ym === a.start_time.slice(0, 7));
    if (mo) mo.km += a.distance / 1000;
  }
  for (const mo of months) mo.km = Math.round(mo.km);
  const bestMonth = months.length ? months.reduce((b, x) => (x.km > b.km ? x : b)) : null;

  const hours = new Map<number, number>();
  const weekdays = new Map<number, number>();
  let before7 = 0;
  for (const a of runs) {
    const h = Number(a.start_time.slice(11, 13));
    hours.set(h, (hours.get(h) ?? 0) + 1);
    if (h < 7) before7++;
    const wd = new Date(atNoon(dayOf(a.start_time))).getUTCDay();
    weekdays.set(wd, (weekdays.get(wd) ?? 0) + 1);
  }
  const top = <K,>(m: Map<K, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0];
  const h0 = top(hours);
  const w0 = top(weekdays);

  const treadmill = runs.filter((a) => UNMEASURED_RUN_TYPES.includes(a.activity_type ?? '')).length;
  const long = runs.reduce<YearActivityRow | null>((b, a) => (!b || a.distance > b.distance ? a : b), null);

  // The year's bests, the same way the profile counts them, but only from this year's runs.
  const bests = computeDistanceBests(runs)
    .filter((b) => b.seconds != null && b.date)
    .map((b) => ({ key: b.key, seconds: b.seconds!, date: dayOf(b.date!), activityId: b.activityId }));

  // "The run of the year": the longest race distance with a best this year, when its run has
  // a route to draw. Its time is the whole run's own (the official time, when the admin typed
  // one, replaces it on the server side).
  let moment: YearMoment | null = null;
  for (const key of ['fm', 'hm'] as const) {
    const b = bests.find((x) => x.key === key);
    const act = b?.activityId ? runs.find((a) => a.id === b.activityId) : null;
    const route = act?.route_preview_hd?.length ? act.route_preview_hd : act?.route_preview ?? [];
    if (act && route.length > 2) {
      moment = { activityId: act.id, key, name: act.activity_name ?? null, date: dayOf(act.start_time), km: Math.round(act.distance / 100) / 10, seconds: Math.round(act.duration), route };
      break;
    }
  }

  return {
    from: window.from,
    to: window.to,
    totalDays,
    km: Math.round(km),
    runs: runs.length,
    hours: Math.round(sec / 3600),
    elevM: Math.round(runs.reduce((s, a) => s + (a.elevation_gain ?? 0), 0)),
    calories: Math.round(runs.reduce((s, a) => s + (a.calories ?? 0), 0)),
    runDates,
    restDays: totalDays - runDates.length,
    activeWeeks,
    totalWeeks: Math.ceil(totalDays / 7),
    streak,
    months,
    bestMonth: bestMonth && bestMonth.km > 0 ? bestMonth : null,
    commonHour: h0 ? h0[0] : null,
    before7,
    topWeekday: w0 ? { day: w0[0], runs: w0[1] } : null,
    doubleDays: [...perDay.values()].filter((n) => n >= 2).length,
    over30: runs.filter((a) => a.distance >= 30_000).length,
    avgKm: runs.length ? Math.round((km / runs.length) * 10) / 10 : 0,
    outdoor: runs.length - treadmill,
    treadmill,
    longest: long ? { km: Math.round(long.distance / 100) / 10, date: dayOf(long.start_time), name: long.activity_name ?? null } : null,
    bests,
    moment,
  };
}

/** "פעמיים וחצי" — a ratio in words, to the nearest half. */
export function timesInWords(ratio: number): string {
  const r = Math.round(ratio * 2) / 2;
  const whole = Math.floor(r);
  const half = r - whole === 0.5;
  if (whole === 0) return 'חצי פעם';
  if (whole === 1) return half ? 'פעם וחצי' : 'פעם אחת';
  if (whole === 2) return half ? 'פעמיים וחצי' : 'פעמיים';
  return half ? `${whole} וחצי פעמים` : `${whole} פעמים`;
}

export const EVEREST_M = 8849;
export const AZRIELI_ROUND_M = 187;
/** Tel Aviv → Valencia, great circle, rounded: the club's marathon. */
export const TLV_VALENCIA_KM = 3140;
/** A family pizza, roughly. */
export const PIZZA_KCAL = 2000;
