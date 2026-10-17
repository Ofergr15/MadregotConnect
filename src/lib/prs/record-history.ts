import { PR_BUCKETS, bucketEffort, measuredRuns, type RunActivityRow } from './pr-buckets';

/**
 * A personal record's history: every run on which it fell.
 *
 * The PRs tab says "broken 4 times, last 3 weeks ago" under each record, and the
 * record screen draws those runs as a timeline (mockups/prs-tab, approved
 * 2026-10-17). Both are read off this file, and the arithmetic is the SAME
 * `bucketEffort` the record itself is the minimum of — so the last break here is
 * the record the card shows, never a second opinion about it.
 *
 * ── THREE RULES ─────────────────────────────────────────────────────────────
 *
 * • Watch runs only. A time the athlete typed in (overrides.ts) has no run
 *   behind it and no history; the record screen draws it as a dashed line over
 *   the watch's breaks instead, and the tab just says "entered by hand".
 *
 * • Outdoor, measured runs only — `measuredRuns`, the same filter the record
 *   uses. A treadmill 5K cannot be a break of a record it cannot hold.
 *
 * • The walk-run start is not history. Everybody's first "5K" on a new watch is
 *   a 49-minute run-walk, and the next three runs each beat it by a minute. On
 *   the club's own data that made the 5K "broken 7 times" for a runner whose
 *   real 5K improved four times. A break counts once it is within
 *   `WALK_ERA_RATIO` of the athlete's best, which is what the mockups were
 *   checked against on ten real athletes.
 */

/** One run on which a record fell. */
export interface RecordBreak {
  /** The run's start, as stored (local wall clock — read the date off the string). */
  date: string;
  seconds: number;
  activityId: string | null;
  activityName: string | null;
  fromSegment: boolean;
  sourceMeters: number;
}

/**
 * A break counts once it is within this factor of the athlete's best: 1.35 is
 * 18:12 → 24:34 on a 5K, slower than any of that runner's real 5Ks and faster
 * than his run-walk starts.
 */
export const WALK_ERA_RATIO = 1.35;

/** How many breaks the timeline draws. The list under it shows all of them. */
export const CHART_MAX_POINTS = 6;

/**
 * Every run that set a new best in this bucket, oldest first — raw, before the
 * walk-run start is cut (`realBreaks`). Strictly faster: equalling a record is
 * not breaking it.
 */
export function recordBreaks(runs: RunActivityRow[], bucketKey: string): RecordBreak[] {
  const bucket = PR_BUCKETS.find((b) => b.key === bucketKey);
  if (!bucket) return [];
  const ordered = [...measuredRuns(runs)].sort(
    (a, b) => a.start_time.localeCompare(b.start_time) || String(a.id ?? '').localeCompare(String(b.id ?? '')),
  );
  const out: RecordBreak[] = [];
  let best = Infinity;
  for (const r of ordered) {
    const effort = bucketEffort(r, bucket);
    if (!effort || effort.seconds >= best) continue;
    best = effort.seconds;
    out.push({
      date: r.start_time,
      seconds: effort.seconds,
      activityId: r.id ?? null,
      activityName: r.activity_name ?? null,
      fromSegment: effort.fromSegment,
      sourceMeters: r.distance,
    });
  }
  return out;
}

/** The breaks worth calling history: within WALK_ERA_RATIO of the best one. */
export function realBreaks<T extends { seconds: number }>(breaks: T[]): T[] {
  if (breaks.length === 0) return [];
  const best = Math.min(...breaks.map((b) => b.seconds));
  return breaks.filter((b) => b.seconds <= best * WALK_ERA_RATIO);
}

/** bucket key → its history, oldest first. Every bucket is present; empty when never run. */
export function computeRecordHistory(runs: RunActivityRow[]): Record<string, RecordBreak[]> {
  const out: Record<string, RecordBreak[]> = {};
  for (const b of PR_BUCKETS) out[b.key] = realBreaks(recordBreaks(runs, b.key));
  return out;
}

/**
 * The best effort per bucket inside one calendar year ("2026"), for "this year:
 * 37:55" beside a record that is older. Null when the bucket wasn't run that year.
 */
export function yearBests(runs: RunActivityRow[], year: string): Record<string, number | null> {
  const inYear = measuredRuns(runs).filter((r) => r.start_time.slice(0, 4) === year);
  const out: Record<string, number | null> = {};
  for (const b of PR_BUCKETS) {
    let best: number | null = null;
    for (const r of inYear) {
      const e = bucketEffort(r, b);
      if (e && (best == null || e.seconds < best)) best = e.seconds;
    }
    out[b.key] = best;
  }
  return out;
}

/**
 * The last `max` breaks for the timeline, and how many older ones it leaves out
 * ("6 earlier"). Twelve dots do not fit a phone; the list under the chart is
 * where all of them are.
 */
export function chartWindow<T>(breaks: T[], max = CHART_MAX_POINTS): { points: T[]; hidden: number } {
  const hidden = Math.max(0, breaks.length - max);
  return { points: breaks.slice(hidden), hidden };
}

/** A record as the record screen needs it — the merged PR (overrides.ts) narrowed. */
export interface RecordLike {
  seconds: number | null;
  date: string | null;
  source?: 'auto' | 'manual';
  note?: string | null;
}

export interface RecordListRow<T> {
  kind: 'run' | 'manual';
  /** The break, for a run row. */
  run: T | null;
  seconds: number;
  date: string | null;
  /** Seconds faster than the break before it; null for the first one and for a manual row. */
  gain: number | null;
  /** The filled dot: today's record. Never set when the record is a stated time. */
  current: boolean;
}

export interface RecordScreenModel<T> {
  /** Nothing to show — the bucket is empty (never run, or hidden). */
  empty: boolean;
  manual: boolean;
  /**
   * The stated time is faster than everything the watch saw, so the chart draws
   * it as a dashed line above the dots and the list starts with it.
   */
  manualAbove: boolean;
  /**
   * `chart` with two or more breaks; `single` for exactly one (a lone dot reads as
   * a bug, so a sentence says it instead); `none` when there is nothing to draw.
   */
  body: 'chart' | 'single' | 'none';
  /** Newest first: the manual row (when there is one) and then every break. */
  rows: RecordListRow<T>[];
  /** Breaks, for the "broken N times" heading. */
  breakCount: number;
}

/** What the record screen draws for one bucket. Pure, so the edge cases are tested. */
export function recordScreenModel<T extends { seconds: number; date: string }>(
  record: RecordLike,
  breaks: T[],
): RecordScreenModel<T> {
  if (record.seconds == null) {
    return { empty: true, manual: false, manualAbove: false, body: 'none', rows: [], breakCount: 0 };
  }
  const manual = record.source === 'manual';
  const watchBest = breaks.length ? Math.min(...breaks.map((b) => b.seconds)) : Infinity;
  const manualAbove = manual && record.seconds < watchBest;

  const runRows: RecordListRow<T>[] = breaks
    .map((b, i) => ({
      kind: 'run' as const,
      run: b,
      seconds: b.seconds,
      date: b.date,
      gain: i > 0 ? breaks[i - 1].seconds - b.seconds : null,
      current: !manual && i === breaks.length - 1,
    }))
    .reverse();
  const manualRow: RecordListRow<T>[] = manual
    ? [{ kind: 'manual', run: null, seconds: record.seconds, date: record.date, gain: null, current: false }]
    : [];

  const body = breaks.length >= 2 ? 'chart' : breaks.length === 1 && !manual ? 'single' : 'none';
  return {
    empty: false,
    manual,
    manualAbove,
    body,
    rows: [...manualRow, ...runRows],
    breakCount: breaks.length,
  };
}

/**
 * The timeline's geometry: one point per break, evenly spaced along the time
 * axis left to right (oldest left, even in Hebrew), faster HIGHER. Even spacing
 * rather than true time, because the date is written under every point — two
 * records a week apart must not collide.
 */
export interface TimelineLayout {
  width: number;
  height: number;
  axisY: number;
  /** Left edge of the plot, wider when the "N earlier" stub is drawn. */
  padLeft: number;
  /** The y of the dashed manual line, when there is one. */
  manualY: number | null;
  points: Array<{ x: number; y: number; current: boolean }>;
}

export function timelineLayout(
  seconds: number[],
  opts: { hidden: number; manualAbove: boolean; currentIsLast: boolean },
): TimelineLayout {
  const width = 362;
  const padLeft = opts.hidden ? 52 : 34;
  const padRight = 34;
  const top = opts.manualAbove ? 64 : 44;
  const bottom = 172;
  const axisY = bottom + 26;
  const height = 236 + (opts.hidden ? 14 : 0);
  const n = seconds.length;
  const fast = Math.min(...seconds);
  const slow = Math.max(...seconds);
  const x = (i: number) => (n === 1 ? width / 2 : padLeft + (i * (width - padLeft - padRight)) / (n - 1));
  const y = (s: number) => (slow === fast ? (top + bottom) / 2 : top + ((s - fast) / (slow - fast)) * (bottom - top));
  return {
    width,
    height,
    axisY,
    padLeft,
    manualY: opts.manualAbove ? 22 : null,
    points: seconds.map((s, i) => ({ x: x(i), y: y(s), current: opts.currentIsLast && i === n - 1 })),
  };
}

/**
 * Under each dot: month and year ("מאי 26"), unless a neighbour falls in the same
 * month — then both get the day as well, or the axis reads "May 26, May 26".
 */
export function timelineDateParts(dates: string[]): Array<{ day: number | null; month: number; year: number }> {
  const ym = dates.map((d) => d.slice(0, 7));
  return dates.map((d, i) => ({
    day: ym[i - 1] === ym[i] || ym[i + 1] === ym[i] ? Number(d.slice(8, 10)) : null,
    month: Number(d.slice(5, 7)),
    year: Number(d.slice(0, 4)),
  }));
}

/** Whole calendar days from `fromIso` to `toIso` (both read as dates, not instants). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** "last … ago" in one unit, the way the mockup words it. */
export function agoUnit(days: number): { unit: 'days' | 'weeks' | 'months' | 'years'; n: number } {
  const d = Math.max(0, days);
  if (d < 14) return { unit: 'days', n: d };
  if (d < 60) return { unit: 'weeks', n: Math.round(d / 7) };
  if (d < 365) return { unit: 'months', n: Math.round(d / 30) };
  return { unit: 'years', n: Math.round(d / 365) };
}
