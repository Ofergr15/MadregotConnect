import { shiftDate } from './load';

/**
 * "The normal range" of sleep and resting HR (spec §3.5, mockup 1/8, TP Health Insights).
 *
 * Normal = P25…P75 of the last 30 days, today excluded — the middle half of the trainee's
 * own nights. It needs 14 values; before that the screens say "לומד אותך, עוד N לילות".
 * A missing night is skipped: it neither counts toward the 14 nor breaks a streak.
 *
 * Long sleep and a low resting HR are good news (✓), never a warning.
 */

export const RANGE_DAYS = 30;
export const MIN_VALUES = 14;

/** Below P25 by more than this is "מעט מאוד שינה". */
export const SLEEP_VERY_LITTLE_SEC = 45 * 60;
/** Above the high line by more than this is "▲ גבוה" rather than "▲ קצת גבוה". */
export const RHR_HIGH_MARGIN = 5;

/**
 * Where "high" starts for resting HR — decision D2 (mockup decision #2), still open with
 * Ofer. `p75` is the spec; `meanSd` is the mockup's proposal (mean + 1 SD), so that
 * "קצת גבוה" is not a one-morning-in-four event. One switch for the verdict, the streak,
 * the coach flag and the pace-suggestion gate alike.
 */
export const RHR_HIGH_RULE: 'p75' | 'meanSd' = 'p75';

export interface WellnessNight {
  date: string;
  sleep_seconds?: number | null;
  resting_hr?: number | null;
}

export type RangeField = 'sleep_seconds' | 'resting_hr';

export interface NormalRange {
  lo: number;
  hi: number;
  n: number;
  mean: number;
  sd: number;
}

export type RangeResult = NormalRange | { learning: number };

export const isLearning = (r: RangeResult): r is { learning: number } => 'learning' in r;

/** Linear-interpolation percentile (type 7) of an ascending array; `p` in 0…1. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** The values of the 30 days before `today`. */
export function windowValues(nights: WellnessNight[], today: string, field: RangeField): number[] {
  const from = shiftDate(today, -RANGE_DAYS);
  const out: number[] = [];
  for (const n of nights) {
    const v = Number(n[field]);
    if (n.date >= from && n.date < today && v > 0) out.push(v);
  }
  return out;
}

/** P25…P75 over the window, or how many more nights it needs. */
export function normalRange(nights: WellnessNight[], today: string, field: RangeField): RangeResult {
  const values = windowValues(nights, today, field).sort((a, b) => a - b);
  if (values.length < MIN_VALUES) return { learning: MIN_VALUES - values.length };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
  return { lo: percentile(values, 0.25), hi: percentile(values, 0.75), n: values.length, mean, sd };
}

export type SleepVerdict = 'veryLittle' | 'less' | 'normal' | 'more';
export type RhrVerdict = 'high' | 'bitHigh' | 'normal' | 'low';

export function sleepVerdict(sec: number | null | undefined, range: RangeResult): SleepVerdict | null {
  if (!(Number(sec) > 0) || isLearning(range)) return null;
  const s = Number(sec);
  if (s < range.lo - SLEEP_VERY_LITTLE_SEC) return 'veryLittle';
  if (s < range.lo) return 'less';
  if (s > range.hi) return 'more';
  return 'normal';
}

/** Above this is "קצת גבוה" — per RHR_HIGH_RULE. */
export function rhrHighLine(range: NormalRange): number {
  return RHR_HIGH_RULE === 'meanSd' ? range.mean + range.sd : range.hi;
}

export function rhrVerdict(bpm: number | null | undefined, range: RangeResult): RhrVerdict | null {
  if (!(Number(bpm) > 0) || isLearning(range)) return null;
  const v = Number(bpm);
  const line = rhrHighLine(range);
  if (v > line + RHR_HIGH_MARGIN) return 'high';
  if (v > line) return 'bitHigh';
  if (v < range.lo) return 'low';
  return 'normal';
}

/**
 * The 3-morning rule: three recorded mornings in a row above the high line raise the flag
 * (the coach sees it on C1, the pace-up suggestion pauses); two in a row back inside (or
 * below) clear it. `nights` oldest first; mornings with no RHR are skipped.
 */
export function rhrStreak(nights: WellnessNight[], range: RangeResult): { flag: boolean; aboveRun: number } {
  if (isLearning(range)) return { flag: false, aboveRun: 0 };
  const line = rhrHighLine(range);
  let flag = false;
  let aboveRun = 0;
  let insideRun = 0;
  for (const n of [...nights].sort((a, b) => a.date.localeCompare(b.date))) {
    const v = Number(n.resting_hr);
    if (!(v > 0)) continue;
    if (v > line) {
      aboveRun += 1;
      insideRun = 0;
      if (aboveRun >= 3) flag = true;
    } else {
      insideRun += 1;
      aboveRun = 0;
      if (insideRun >= 2) flag = false;
    }
  }
  return { flag, aboveRun };
}

/** Seconds of sleep as "7:12". */
export function fmtSleep(sec: number): string {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** The i18n key of a verdict (`trainee.range.sleep.less`, `trainee.range.rhr.bitHigh`). */
export function verdictKey(kind: 'sleep' | 'rhr', verdict: SleepVerdict | RhrVerdict): string {
  return `trainee.range.${kind}.${verdict}`;
}
