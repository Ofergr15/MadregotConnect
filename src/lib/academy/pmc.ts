import { daysBetween, shiftDate, type LoadSource } from './load';

/**
 * Fitness, fatigue and form (TP's PMC) — spec §3.2, mockup 7/7ב/C2.
 *
 *   fitness F_d = F_{d−1} + (L_d − F_{d−1}) / 42
 *   fatigue A_d = A_{d−1} + (L_d − A_{d−1}) / 7
 *
 * over ONE daily-load series (the per-activity loads summed per Israel day, 0 on rest
 * days), seeded at 0 on the first day of history. Everything is "as of yesterday": form
 * = F[y] − A[y] and ramp = F[y] − F[y−7] (mockup 7ב: "נכון לאתמול. הריצה של היום נכנסת
 * מחר"), so today's run changes tomorrow's numbers, never the ones the trainee is
 * reading before it.
 *
 * Nothing here is stored (plan §1.2): ~400 EWMA steps a read is microseconds, and a cache
 * would go stale on every late sync and every new test.
 */

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;
/** Fewer days than this since the first loaded run → "לומד אותך, עוד N ימים". */
export const LEARNING_DAYS = 42;
/** More than this share of the last 42 days' runs unpriced → "אין מספיק נתונים". */
export const INSUFFICIENT_SHARE = 0.2;
/** A week planned (or run) at or below this share of the previous 4 weeks' mean is easy. */
export const EASY_WEEK_SHARE = 0.75;

/** One stored activity load (an `activity_loads` row, or its in-memory twin). */
export interface LoadRow {
  date: string;
  load: number | null;
  source: LoadSource;
}

export interface DailyLoad {
  date: string;
  load: number;
}

export interface PmcPoint {
  date: string;
  load: number;
  fitness: number;
  fatigue: number;
}

const PRICED: ReadonlySet<LoadSource> = new Set(['pace', 'pace_avg', 'hr']);
/** Runs, priced or not — the denominator of the 20% rule. `not_run` is not one. */
const RUNS: ReadonlySet<LoadSource> = new Set(['pace', 'pace_avg', 'hr', 'none']);

/** Every day from `from` to `to` inclusive with the day's summed load (0 on rest days). */
export function dailyLoads(rows: LoadRow[], from: string, to: string): DailyLoad[] {
  if (from > to) return [];
  const sum = new Map<string, number>();
  for (const r of rows) {
    if (r.load == null || r.date < from || r.date > to) continue;
    sum.set(r.date, (sum.get(r.date) ?? 0) + r.load);
  }
  const out: DailyLoad[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push({ date: d, load: sum.get(d) ?? 0 });
  return out;
}

/** One EWMA step for both lines. */
function step(prev: { fitness: number; fatigue: number }, load: number) {
  return {
    fitness: prev.fitness + (load - prev.fitness) / FITNESS_DAYS,
    fatigue: prev.fatigue + (load - prev.fatigue) / FATIGUE_DAYS,
  };
}

/** The PMC over a contiguous daily series, seeded at 0 the day before its first day. */
export function pmcSeries(daily: DailyLoad[]): PmcPoint[] {
  let state = { fitness: 0, fatigue: 0 };
  return daily.map(({ date, load }) => {
    state = step(state, load);
    return { date, load, ...state };
  });
}

/**
 * The series continued over planned (or any future) daily loads — C2's dashed
 * projection, from the last real point onward.
 */
export function projectSeries(series: PmcPoint[], futureDaily: DailyLoad[]): PmcPoint[] {
  let state: { fitness: number; fatigue: number } = series.length ? series[series.length - 1] : { fitness: 0, fatigue: 0 };
  return futureDaily.map(({ date, load }) => {
    state = step(state, load);
    return { date, load, ...state };
  });
}

/** The point for `date`: decayed with zero load past the series' end, 0 before its start. */
export function pointOn(series: PmcPoint[], date: string): { fitness: number; fatigue: number } {
  if (!series.length || date < series[0].date) return { fitness: 0, fatigue: 0 };
  const last = series[series.length - 1];
  if (date > last.date) {
    let state: { fitness: number; fatigue: number } = last;
    for (let n = daysBetween(last.date, date); n > 0; n -= 1) state = step(state, 0);
    return state;
  }
  // The series is contiguous (dailyLoads), so a day is an index.
  return series[daysBetween(series[0].date, date)] ?? { fitness: 0, fatigue: 0 };
}

export interface PmcToday {
  fitness: number;
  fatigue: number;
  form: number;
  ramp: number;
}

/** Today's four numbers, all as of yesterday (§0.2 of the build plan). Unrounded. */
export function pmcToday(series: PmcPoint[], today: string): PmcToday {
  const y = shiftDate(today, -1);
  const now = pointOn(series, y);
  const weekAgo = pointOn(series, shiftDate(y, -7));
  return {
    fitness: now.fitness,
    fatigue: now.fatigue,
    form: now.fitness - now.fatigue,
    ramp: now.fitness - weekAgo.fitness,
  };
}

export type LoadStatus =
  | { kind: 'ok' }
  | { kind: 'learning'; daysLeft: number; daysSeen: number }
  | { kind: 'insufficient' };

/**
 * Whether the numbers mean anything yet.
 *
 * - `learning`: fewer than 42 days since the first priced run (mockup 1ג "19 מתוך 42
 *   ימים · לומד אותך, עוד 23 ימים"). With no priced run at all, also learning — unless
 *   there are runs and none of them could be priced, which is `insufficient`.
 * - `insufficient`: more than 20% of the last 42 days' runs have no load. `not_run`
 *   (bike, swim, gym) is not a run and does not count either way.
 */
export function loadStatus(rows: LoadRow[], today: string): LoadStatus {
  const windowFrom = shiftDate(today, -LEARNING_DAYS);
  let first: string | null = null;
  let runs = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (r.date > today) continue;
    if (PRICED.has(r.source) && r.load != null && (!first || r.date < first)) first = r.date;
    if (r.date >= windowFrom && r.date < today && RUNS.has(r.source)) {
      runs += 1;
      if (r.source === 'none' || r.load == null) unpriced += 1;
    }
  }
  if (!first) return runs > 0 ? { kind: 'insufficient' } : { kind: 'learning', daysLeft: LEARNING_DAYS, daysSeen: 0 };
  const daysSeen = daysBetween(first, today);
  if (daysSeen < LEARNING_DAYS) return { kind: 'learning', daysLeft: LEARNING_DAYS - daysSeen, daysSeen };
  if (runs > 0 && unpriced / runs > INSUFFICIENT_SHARE) return { kind: 'insufficient' };
  return { kind: 'ok' };
}

export interface WeeklyLoad {
  weekStart: string;
  done: number;
  /** The planned load (E2), when the week has a plan we priced; else null. */
  planned: number | null;
  easy: boolean;
}

/**
 * A planned easy week: its load (planned, or done when there is no plan) at or below
 * 0.75 × the mean of the previous (up to 4) weeks. No previous weeks → not easy.
 */
export function isEasyWeek(value: number, prev: number[]): boolean {
  const last = prev.slice(-4).filter(v => Number.isFinite(v));
  if (!last.length) return false;
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  return mean > 0 && value <= EASY_WEEK_SHARE * mean;
}

/**
 * The weekly bars (mockup 3): each Sunday week's done load, its planned load where
 * known, and whether it is an easy week. `weeks` are Sunday starts, oldest first.
 * The previous weeks an easy week is judged against are their DONE loads, which
 * exist for every past week; `priorDone` supplies the weeks before the first bar.
 * A week still running (it holds `today`) with no plan is never easy: its done load is
 * only the days so far.
 */
export function weeklyLoads(
  daily: DailyLoad[],
  plannedByWeek: Record<string, number | undefined>,
  weeks: string[],
  priorDone: number[] = [],
  today?: string,
): WeeklyLoad[] {
  const doneOf = (start: string) => {
    const end = shiftDate(start, 6);
    return daily.reduce((sum, d) => (d.date >= start && d.date <= end ? sum + d.load : sum), 0);
  };
  const history = [...priorDone];
  return weeks.map((weekStart) => {
    const done = Math.round(doneOf(weekStart));
    const p = plannedByWeek[weekStart];
    const planned = p != null && p > 0 ? Math.round(p) : null;
    const running = !!today && today <= shiftDate(weekStart, 6);
    const easy = planned != null ? isEasyWeek(planned, history) : !running && isEasyWeek(done, history);
    history.push(done);
    return { weekStart, done, planned, easy };
  });
}

/** The Sunday that starts `date`'s plan week (planWeekStartOf, without a clock or a zone). */
export function weekStartOf(date: string): string {
  const dow = new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -dow);
}

/** The `n` Sunday weeks ending with the one holding `today`, oldest first. */
export function lastWeeks(today: string, n: number): string[] {
  const current = weekStartOf(today);
  return Array.from({ length: n }, (_, i) => shiftDate(current, -7 * (n - 1 - i)));
}
