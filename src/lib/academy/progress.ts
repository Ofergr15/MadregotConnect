import { daysBetween } from './load';
import { weekStartOf } from './pmc';
import type { LoadPayload, LoadRange } from './load-payload';
import { isHeavyWeek, type FormBandKey } from './form-bands';
import { smoothPath, xAt } from '@/lib/charts/timeline';

/**
 * "התקדמות" (trainee-experience-v2 screens 7, 7ב, 7ג, 8): what the page reads off the URL
 * and off /api/academy/load, without React — the chart geometry, the ramp sentence and
 * the threshold row, so each is tested on numbers rather than on pixels.
 *
 * Everything returns i18n keys (`trainee.progress.*`) and params, never text.
 */

export type ProgressView = 'progress' | 'tests' | 'body';

/** `?view=` → the screen: unset is 7, `tests` is 7ג, `body` is 8. */
export function progressView(param: string | null | undefined): ProgressView {
  return param === 'tests' || param === 'body' ? param : 'progress';
}

/** The range control: "עד המרוץ" only with a race ahead. */
export function rangeOptions(raceDate: string | null | undefined): LoadRange[] {
  return raceDate ? ['6w', '3m', 'race'] : ['6w', '3m'];
}

// ── The fitness / fatigue chart (7) ────────────────────────────────────────────────────

/** Past this span the chart draws one point a week (the mockup's Mondays). */
export const WEEKLY_FROM_DAYS = 49;

/**
 * The points the line goes through. Six weeks are drawn day by day; a longer range one
 * point per week (each week's first sample) plus the last day, so the 3-day sampling of
 * a run-every-other-day week does not alias into a saw-tooth. The end point — today's
 * number — is always the real last one.
 */
export function chartPoints(series: LoadPayload['series']): LoadPayload['series'] {
  if (series.length < 3) return series;
  const span = daysBetween(series[0].date, series[series.length - 1].date);
  if (span <= WEEKLY_FROM_DAYS) return series;
  const out: LoadPayload['series'] = [];
  let lastWeek = '';
  for (const p of series.slice(0, -1)) {
    const week = weekStartOf(p.date);
    if (week === lastWeek) continue;
    lastWeek = week;
    out.push(p);
  }
  const last = series[series.length - 1];
  // A weekly point right before the end would make a kink: today replaces it.
  if (out.length && daysBetween(out[out.length - 1].date, last.date) < 3) out.pop();
  out.push(last);
  return out;
}

export const FITNESS_CHART = { width: 326, height: 150, padL: 14, padR: 12, padY: 8 } as const;

export interface FitnessChartGeometry {
  width: number;
  height: number;
  fitnessPath: string;
  /** The light fill under the fitness line. */
  fitnessArea: string;
  fatiguePath: string;
  /** The two end dots, at today (= the last point, yesterday's values). */
  end: { x: number; fitnessY: number; fatigueY: number; fitness: number; fatigue: number };
  /** Three faint gridlines. */
  grid: number[];
  /** HTML labels under the chart: the first point of each month, and "היום" at the right. */
  labels: Array<{ x: number; kind: 'month' | 'ago' | 'today' | 'next'; date: string; align: 'start' | 'center' | 'end'; weeks?: number }>;
  /**
   * C2's dashed projection, in its own fixed-width zone to the RIGHT of today (spec G1:
   * the future continues further right): the zone's left edge, the two dashed lines from
   * today's dots, and the hollow end dots. Null without a projection.
   */
  projection: {
    zoneX: number;
    fitnessPath: string;
    fatiguePath: string;
    end: { x: number; fitnessY: number; fatigueY: number };
  } | null;
}

/** The projection zone's width (the mockup's C2: 78 of 326). */
export const PROJECTION_WIDTH = 78;

/**
 * The PMC chart: fitness thick, fatigue thin, OLDEST LEFT and today on the far right
 * (`xAt`, spec G1), so fitness that is being built rises toward "היום". x is by DAY, not
 * by sample, so a sparse 3-month series is spaced like the calendar. Null with fewer than
 * two points — the page then hides the card rather than drawing a dot.
 */
export function fitnessChart(
  all: LoadPayload['series'],
  opts: {
    width?: number;
    height?: number;
    /** C2: the projected points after today, oldest first (lib/academy/readiness-board.ts). */
    projection?: LoadPayload['series'];
    /** `weeks`: "לפני חודשיים · לפני חודש · היום · שבוע הבא" instead of month names. */
    axis?: 'months' | 'weeks';
  } = {},
): FitnessChartGeometry | null {
  const series = chartPoints(all);
  if (series.length < 2) return null;
  const width = opts.width ?? FITNESS_CHART.width;
  const height = opts.height ?? FITNESS_CHART.height;
  const { padL, padR, padY } = FITNESS_CHART;
  const first = series[0].date;
  const lastDate = series[series.length - 1].date;
  const span = Math.max(1, daysBetween(first, lastDate));
  const future = (opts.projection ?? []).filter(p => p.date > lastDate);
  // With a projection, today sits at the left edge of a fixed zone on the far right, and
  // the future is spread by day inside it; without one, today is at the right padding.
  const zone = future.length ? PROJECTION_WIDTH : 0;
  const futureSpan = future.length ? Math.max(1, daysBetween(lastDate, future[future.length - 1].date)) : 1;
  const x = (date: string) => (date <= lastDate
    ? xAt(daysBetween(first, date), span + 1, width - zone, padL, padR)
    : width - padR - zone + (daysBetween(lastDate, date) / futureSpan) * zone);

  const values = [...series, ...future].flatMap(p => [p.fitness, p.fatigue]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // A little air, and never a flat line drawn across the middle as if it were a trend.
  const pad = Math.max(3, (hi - lo) * 0.12);
  lo = Math.max(0, Math.floor(lo - pad));
  hi = Math.ceil(hi + pad);
  if (hi - lo < 10) hi = lo + 10;
  const y = (v: number) => padY + ((hi - v) / (hi - lo)) * (height - 2 * padY);

  const fit = series.map(p => [x(p.date), y(p.fitness)] as [number, number]);
  const fat = series.map(p => [x(p.date), y(p.fatigue)] as [number, number]);
  const fitnessPath = smoothPath(fit);
  const last = series[series.length - 1];
  const endX = fit[fit.length - 1][0];

  const labels: FitnessChartGeometry['labels'] = [];
  if (opts.axis === 'weeks') {
    // C2: how long ago, in weeks — the first point, and four weeks back when there is room.
    const weeksAgo = (d: string) => Math.round(daysBetween(d, last.date) / 7);
    labels.push({ x: x(first), kind: 'ago', date: first, align: 'start', weeks: weeksAgo(first) });
    const mid = series.find(p => weeksAgo(p.date) === 4);
    if (mid && weeksAgo(first) >= 7) labels.push({ x: x(mid.date), kind: 'ago', date: mid.date, align: 'center', weeks: 4 });
  } else {
    let month = '';
    for (const p of series) {
      const m = p.date.slice(0, 7);
      if (m === month) continue;
      month = m;
      const px = x(p.date);
      // A month starting under "היום" would collide with it; the first point is always named.
      if (labels.length && endX - px < 46) continue;
      labels.push({ x: px, kind: 'month', date: p.date, align: labels.length ? 'center' : 'start' });
    }
    // A month squeezed against the first label (a range that opens on the 29th) is dropped.
    if (labels.length > 1 && labels[1].x - labels[0].x < 44) labels.splice(1, 1);
  }
  // With a projection "היום" is centred over its dot (the next week's label takes the end).
  labels.push({ x: endX, kind: 'today', date: last.date, align: future.length ? 'center' : 'end' });

  let projection: FitnessChartGeometry['projection'] = null;
  if (future.length) {
    const fp: Array<[number, number]> = [[endX, y(last.fitness)], ...future.map(p => [x(p.date), y(p.fitness)] as [number, number])];
    const ap: Array<[number, number]> = [[endX, y(last.fatigue)], ...future.map(p => [x(p.date), y(p.fatigue)] as [number, number])];
    const tip = future[future.length - 1];
    projection = {
      zoneX: endX,
      fitnessPath: smoothPath(fp),
      fatiguePath: smoothPath(ap),
      end: { x: x(tip.date), fitnessY: y(tip.fitness), fatigueY: y(tip.fatigue) },
    };
    labels.push({ x: x(tip.date), kind: 'next', date: tip.date, align: 'end' });
  }

  return {
    width,
    height,
    fitnessPath,
    fitnessArea: `${fitnessPath} L${endX.toFixed(1)} ${height} L${fit[0][0].toFixed(1)} ${height} Z`,
    fatiguePath: smoothPath(fat),
    end: { x: endX, fitnessY: y(last.fitness), fatigueY: y(last.fatigue), fitness: Math.round(last.fitness), fatigue: Math.round(last.fatigue) },
    grid: [0.25, 0.5, 0.75].map(t => padY + t * (height - 2 * padY)),
    labels,
    projection,
  };
}

// ── The form strip (7) ─────────────────────────────────────────────────────────────────

/** One cell per week, oldest first; the last cell is this week (outlined), and its word. */
export function formStrip(weeks: LoadPayload['formWeeks']): { cells: Array<{ weekStart: string; band: FormBandKey; current: boolean }>; band: FormBandKey } | null {
  if (!weeks.length) return null;
  return {
    cells: weeks.map((w, i) => ({ weekStart: w.weekStart, band: w.band, current: i === weeks.length - 1 })),
    band: weeks[weeks.length - 1].band,
  };
}

// ── The ramp sentence (7) ──────────────────────────────────────────────────────────────

export interface RampSentence {
  /** `trainee.progress.ramp.up` / `.down` / `.flat`. */
  key: 'up' | 'down' | 'flat';
  n: number;
  /** "שבוע אחרי שבוע עמוס." — last week was heavy against the 4 before it. */
  afterHeavy: boolean;
  /** "מאז יולי עלית 12." — fitness across the range shown, when it moved. */
  since: { date: string; rise: number } | null;
}

export function rampSentence(p: Pick<LoadPayload, 'today' | 'series' | 'weekly'>): RampSentence | null {
  if (!p.today) return null;
  const n = p.today.ramp;
  const key = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  // weekly: 8 Sunday weeks, this one last; "last week" is the one before it.
  const done = p.weekly.map(w => w.done);
  const afterHeavy = done.length >= 3 && isHeavyWeek(done[done.length - 2], done.slice(Math.max(0, done.length - 6), done.length - 2));
  const start = p.series[0];
  const rise = start ? Math.round(p.today.fitness - start.fitness) : 0;
  return { key, n: Math.abs(n), afterHeavy, since: start && rise !== 0 ? { date: start.date, rise } : null };
}

// ── The threshold row (7) and the header of 7ג ─────────────────────────────────────────

export interface ThresholdRow {
  paceSec: number;
  testDate: string | null;
  /** The test before it, and how many seconds faster (positive) this one is. */
  previous: { paceSec: number; date: string; fasterBy: number } | null;
}

export function thresholdRow(p: Pick<LoadPayload, 'thresholdSec' | 'basisTestDate' | 'previousTest'>): ThresholdRow | null {
  if (!p.thresholdSec) return null;
  return {
    paceSec: p.thresholdSec,
    testDate: p.basisTestDate,
    previous: p.previousTest
      ? { paceSec: p.previousTest.thresholdSec, date: p.previousTest.date, fasterBy: p.previousTest.thresholdSec - p.thresholdSec }
      : null,
  };
}

/** 7ג's "▲ 26 שנ׳ מאז מרץ": the first counted test against the latest. Null with one test. */
export function sinceFirstTest(points: Array<{ date: string; paceSec: number | null }>): { fasterBy: number; since: string } | null {
  const counted = points.filter(p => p.paceSec != null && p.paceSec > 0);
  if (counted.length < 2) return null;
  const first = counted[0];
  const last = counted[counted.length - 1];
  return { fasterBy: Math.round((first.paceSec as number) - (last.paceSec as number)), since: first.date };
}

// ── 7ב: the metric sheet ───────────────────────────────────────────────────────────────

export type Metric = 'fitness' | 'fatigue' | 'form' | 'ramp';

/** The ramp's bands, top first — the sheet's list when it opens from the ramp chip. */
export const RAMP_BANDS = [
  { key: 'tooFast', min: 9, max: null, color: '#E8890C' },
  { key: 'building', min: 5, max: 8, color: '#1FA55B' },
  { key: 'maintaining', min: 0, max: 4, color: '#9AD5B0' },
  { key: 'recovering', min: null, max: -1, color: '#5B9BF0' },
] as const;

export function rampBandOf(ramp: number): (typeof RAMP_BANDS)[number]['key'] {
  const r = Math.round(ramp);
  return r >= 9 ? 'tooFast' : r >= 5 ? 'building' : r >= 0 ? 'maintaining' : 'recovering';
}
