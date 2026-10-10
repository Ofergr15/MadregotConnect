/**
 * The weekly load bars of the month board (trainee-experience-v2 screen 3): geometry and
 * the one sentence under them. Pure, so the x order (oldest LEFT, this week RIGHT, spec
 * G1) and the sentence are tested without a DOM.
 *
 * The bars come from GET /api/academy/load `weekly` (lib/academy/pmc.ts weeklyLoads),
 * oldest first. The last one is this week: solid for what is done so far, a dashed frame
 * for what is planned. The average line is the mean of the weeks BEFORE this one, which
 * are complete — this week's partial load would drag it down every Monday.
 */

import { xAt } from './timeline';

export interface WeeklyBarInput {
  weekStart: string;
  done: number;
  planned: number | null;
  easy: boolean;
}

export interface WeeklyBar {
  weekStart: string;
  /** Centre x of the bar. */
  x: number;
  done: number;
  /** Top of the done bar, and its height. */
  y: number;
  h: number;
  /** This week's planned frame, when it has a plan. */
  planned: { value: number; y: number; h: number } | null;
  tone: 'past' | 'easy' | 'now';
  isNow: boolean;
}

export interface WeeklyChart {
  width: number;
  height: number;
  barW: number;
  baseY: number;
  bars: WeeklyBar[];
  /** Mean done load of the complete weeks; null with fewer than two of them. */
  avg: number | null;
  avgY: number | null;
}

export interface ChartBox { width: number; height: number; top: number; bottom: number; barW: number }
export const CHART: ChartBox = { width: 326, height: 104, top: 18, bottom: 4, barW: 28 };

export function weeklyLoadChart(weekly: WeeklyBarInput[], opts: Partial<ChartBox> = {}): WeeklyChart {
  const { width, height, top, bottom, barW } = { ...CHART, ...opts };
  const n = weekly.length;
  const past = weekly.slice(0, -1).map(w => w.done);
  const avg = past.length >= 2 ? Math.round(past.reduce((a, b) => a + b, 0) / past.length) : null;
  const max = Math.max(1, ...weekly.map(w => Math.max(w.done, w.planned ?? 0)), avg ?? 0) * 1.08;
  const baseY = height - bottom;
  const y = (v: number) => baseY - (v / max) * (height - top - bottom);
  const pad = barW / 2 + 2;
  const bars = weekly.map((w, i): WeeklyBar => {
    const isNow = i === n - 1;
    const plannedValue = isNow && w.planned != null && w.planned > 0 ? w.planned : null;
    return {
      weekStart: w.weekStart,
      x: xAt(i, n, width, pad, pad),
      done: w.done,
      y: y(w.done),
      h: baseY - y(w.done),
      planned: plannedValue != null ? { value: plannedValue, y: y(plannedValue), h: baseY - y(plannedValue) } : null,
      tone: isNow ? 'now' : w.easy ? 'easy' : 'past',
      isNow,
    };
  });
  return { width, height, barW, baseY, bars, avg, avgY: avg != null ? y(avg) : null };
}

export type LoadCompare = 'wellBelow' | 'below' | 'same' | 'above' | 'wellAbove';

/** Planned against the average, in five words. ±5% is "the same"; past ±15% is "well". */
export function compareToAverage(value: number, avg: number): LoadCompare {
  const r = value / avg;
  if (r <= 0.85) return 'wellBelow';
  if (r < 0.95) return 'below';
  if (r <= 1.05) return 'same';
  if (r < 1.15) return 'above';
  return 'wellAbove';
}

/** "After a heavy week": last week's load above 1.15 × the mean of the weeks before it (form-bands' rule). */
export const HEAVY_SHARE = 1.15;

export interface WeeklySentence {
  /** `trainee.month.load.vs.<compare>` with {planned, avg}, or `trainee.month.load.noPlan` with {done, avg}. */
  key: string;
  params: Record<string, number>;
  afterHeavy: boolean;
  /** An easy week is drawn (the light bar), so the sentence says what it is. */
  easyShown: boolean;
}

/** The one sentence under the bars; null when there is no average to compare with. */
export function weeklySentence(weekly: WeeklyBarInput[]): WeeklySentence | null {
  if (weekly.length < 3) return null;
  const now = weekly[weekly.length - 1];
  const past = weekly.slice(0, -1);
  const avg = Math.round(past.reduce((a, w) => a + w.done, 0) / past.length);
  if (!(avg > 0)) return null;
  const last = past[past.length - 1].done;
  const before = past.slice(0, -1).slice(-4).map(w => w.done);
  const beforeMean = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
  const afterHeavy = beforeMean > 0 && last > HEAVY_SHARE * beforeMean;
  const easyShown = past.some(w => w.easy);
  if (now.planned != null && now.planned > 0) {
    return { key: `vs.${compareToAverage(now.planned, avg)}`, params: { planned: now.planned, avg }, afterHeavy, easyShown };
  }
  return { key: 'noPlan', params: { done: now.done, avg }, afterHeavy: false, easyShown };
}
