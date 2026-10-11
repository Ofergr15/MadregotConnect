import { shiftDate } from './load';
import { feedBroken, type DataFeed } from './data-feed';

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
  /** When the row was fetched from Garmin (a night read at 05:30 may still be growing). */
  fetched_at?: string | null;
}

/**
 * Values no body produces: a resting HR outside 25–120 bpm, a night over 16 hours. A watch
 * glitch (an RHR of 250, a 20-hour "sleep") would otherwise stretch the chart's axis to
 * itself and crush the real nights into a flat line, and widen the range.
 */
export const RHR_PLAUSIBLE = { min: 25, max: 120 } as const;
export const SLEEP_MAX_SEC = 16 * 3600;

export function plausible(field: RangeField, value: number | null | undefined): boolean {
  const v = Number(value);
  if (!(v > 0)) return false;
  return field === 'resting_hr' ? v >= RHR_PLAUSIBLE.min && v <= RHR_PLAUSIBLE.max : v <= SLEEP_MAX_SEC;
}

/** The nights with every implausible value blanked (the night itself stays: the other field may be fine). */
export function cleanNights<T extends WellnessNight>(nights: T[]): T[] {
  return nights.map(n => {
    const sleepOk = n.sleep_seconds == null || plausible('sleep_seconds', n.sleep_seconds);
    const rhrOk = n.resting_hr == null || plausible('resting_hr', n.resting_hr);
    return sleepOk && rhrOk ? n : { ...n, sleep_seconds: sleepOk ? n.sleep_seconds : null, resting_hr: rhrOk ? n.resting_hr : null };
  });
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
    if (n.date >= from && n.date < today && plausible(field, v)) out.push(v);
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
    if (!plausible('resting_hr', v)) continue;
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

// ── Why a metric has nothing to show ──────────────────────────────────────────────────

/**
 * Why the sleep or resting-HR slot is empty — or why its newest value gets no verdict —
 * said as the one thing that will make it appear (Ofer's missing-data rule):
 *
 * - `noGarmin`: nights only come from Garmin, and none is connected (Strava, Apple, manual);
 * - `feed`: Garmin is connected but refused the credential or stopped syncing;
 * - `neverWorn`: Garmin syncs, and not one night arrived — the watch is off at night;
 * - `notMeasured`: nights arrive, this field never does — the watch doesn't measure it;
 * - `old`: the newest value is older than `FRESH_DAYS`;
 * - `partial`: last night arrived cut short (sleep without the morning's RHR, or under
 *   3 hours fetched before 07:00): it will be fetched again, no verdict until then.
 */
export type MetricMissing =
  | { reason: 'noGarmin' }
  | { reason: 'feed'; feed: 'failed' | 'stale'; days: number | null }
  | { reason: 'neverWorn' }
  | { reason: 'notMeasured' }
  | { reason: 'old'; date: string }
  | { reason: 'partial'; date: string };

/** A night older than this is not "this morning's" and gets no verdict. */
export const FRESH_DAYS = 3;
/** Under this, a night fetched before 07:00 Israel may still be growing. */
export const PARTIAL_SLEEP_SEC = 3 * 3600;

const israelHour = (iso: string) => {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).format(new Date(iso));
  return Number(h) % 24;
};

/**
 * Is this night cut short? Sleep arrived and the morning's resting HR did not, on a watch
 * that does record RHR (another night in `nights` has one); or under 3 hours of sleep read
 * before 07:00 on the morning after.
 */
export function isPartialNight(night: WellnessNight, nights: WellnessNight[]): boolean {
  const sleep = Number(night.sleep_seconds);
  if (!plausible('sleep_seconds', sleep)) return false;
  const rhrRecorded = nights.some(n => n.date !== night.date && plausible('resting_hr', n.resting_hr));
  if (!plausible('resting_hr', night.resting_hr) && rhrRecorded) return true;
  if (sleep < PARTIAL_SLEEP_SEC && night.fetched_at && Date.parse(night.fetched_at) > 0) {
    const fetchedDay = new Date(Date.parse(night.fetched_at)).toISOString().slice(0, 10);
    // `date` is the morning the night ends on.
    if (fetchedDay <= night.date && israelHour(night.fetched_at) < 7) return true;
  }
  return false;
}

/**
 * The reason a metric has no fresh, judged value as of `today` — or null when its newest
 * value is fresh and whole. `nights` is the window the screen read.
 */
export function metricMissing(
  nights: WellnessNight[],
  today: string,
  field: RangeField,
  feed: DataFeed | null | undefined,
): MetricMissing | null {
  const clean = cleanNights(nights).filter(n => n.date <= today);
  if (feedBroken(feed) && feed.provider === 'garmin') return { reason: 'feed', feed: feed.kind, days: feed.days };
  const withValue = clean.filter(n => plausible(field, n[field])).sort((a, b) => b.date.localeCompare(a.date));
  if (!withValue.length) {
    if (!clean.length) return feed && feed.kind === 'none' ? { reason: 'noGarmin' } : { reason: 'neverWorn' };
    return { reason: 'notMeasured' };
  }
  // The newest night of any kind: a partial one blanks both slots' verdicts.
  const newest = [...clean].sort((a, b) => b.date.localeCompare(a.date))[0];
  // (A short night whose RHR did arrive keeps its RHR: only what is missing waits.)
  if (newest && newest.date >= shiftDate(today, -1) && isPartialNight(newest, clean)
    && (field === 'sleep_seconds' || !plausible('resting_hr', newest.resting_hr))) {
    return { reason: 'partial', date: newest.date };
  }
  if (withValue[0].date < shiftDate(today, -FRESH_DAYS)) return { reason: 'old', date: withValue[0].date };
  return null;
}
