import { shiftDate } from './load';
import {
  RANGE_DAYS, isLearning, normalRange, rhrHighLine, rhrStreak, rhrVerdict, sleepVerdict,
  type RangeResult, type RhrVerdict, type SleepVerdict, type WellnessNight,
} from './normal-range';
import { feelAverage, FEEL_RUNS } from './readiness';
import { xAt } from '@/lib/charts/timeline';

/**
 * "הגוף" (trainee-experience-v2 screen 8, TP Health Insights): resting HR and sleep against
 * the trainee's own normal range, and how the last runs felt. Pure: GET /api/academy/body
 * reads the rows and hands them here; RangeChart draws `rangeChart`.
 *
 * The numbers are the home's (lib/academy/normal-range.ts): P25…P75 of the 30 days before
 * today. A low resting HR and a long night are good news, so only a high RHR and a short
 * night are coloured; everything else is a grey dot inside or outside the band.
 */

export type BodyMetric = 'rhr' | 'sleep' | 'feel';

export interface MetricPanel {
  /** The newest stored morning: today's, or (a phone that synced late) the latest before it. */
  latest: { date: string; value: number } | null;
  /** `latest` is this morning — else the screen names its date ("מ־11.10"). */
  isToday: boolean;
  range: RangeResult;
  verdict: SleepVerdict | RhrVerdict | null;
  /** The 30 days the chart draws, oldest first, today included; missing mornings absent. */
  series: Array<{ date: string; value: number }>;
}

export interface FeelPanel {
  /** Mean of the newest 4 answers, 0 (חלש מאוד) … 4 (חזק מאוד), and the face it rounds to. */
  avg: number;
  face: number;
  /** Mean difficulty 1–10 of the same answers, one decimal. Null when none gave one. */
  effort: number | null;
  n: number;
  /** The same answers, oldest first — the feel "chart" is these as faces, left to right. */
  recent: Array<{ date: string; feel: number; difficulty: number | null }>;
}

export type RhrAdvice = 'streak' | 'twice' | 'once' | 'inside';

export interface BodyPayload {
  rhr: MetricPanel & { streak: { flag: boolean; aboveRun: number }; advice: RhrAdvice | null };
  sleep: MetricPanel;
  feel: FeelPanel | null;
  /** The chart shown first: whatever stands out today. */
  featured: BodyMetric;
}

function panel(nights: WellnessNight[], today: string, field: 'resting_hr' | 'sleep_seconds'): MetricPanel {
  const from = shiftDate(today, -(RANGE_DAYS - 1));
  const recorded = nights
    .filter(n => Number(n[field]) > 0 && n.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const newest = recorded[recorded.length - 1] ?? null;
  // A morning older than the window is not "the latest" any more — it is no data.
  const latest = newest && newest.date >= from ? { date: newest.date, value: Number(newest[field]) } : null;
  // The range is the 30 days before the morning shown, so a late-synced night is judged
  // against the nights before it, not against itself.
  const range = normalRange(nights, latest?.date ?? today, field);
  const verdict = latest
    ? field === 'resting_hr' ? rhrVerdict(latest.value, range) : sleepVerdict(latest.value, range)
    : null;
  return {
    latest,
    isToday: latest?.date === today,
    range,
    verdict,
    series: recorded.filter(n => n.date >= from).map(n => ({ date: n.date, value: Number(n[field]) })),
  };
}

/**
 * The sentence under the RHR chart, from the 3-morning rule (spec §3.5): three above in a
 * row → lower the intensity (the coach sees it too); two → one more and it counts; one →
 * "זה קורה"; inside → nothing to do. Null while the range is being learned.
 */
export function rhrAdvice(streak: { flag: boolean; aboveRun: number }, range: RangeResult): RhrAdvice | null {
  if (isLearning(range)) return null;
  if (streak.flag || streak.aboveRun >= 3) return 'streak';
  if (streak.aboveRun === 2) return 'twice';
  if (streak.aboveRun === 1) return 'once';
  return 'inside';
}

/** What stands out today: a high RHR, then a short night, else the RHR chart (else sleep, else feel). */
export function featuredMetric(p: Pick<BodyPayload, 'rhr' | 'sleep' | 'feel'>): BodyMetric {
  if (p.rhr.isToday && (p.rhr.verdict === 'bitHigh' || p.rhr.verdict === 'high')) return 'rhr';
  if (p.sleep.isToday && (p.sleep.verdict === 'less' || p.sleep.verdict === 'veryLittle')) return 'sleep';
  if (p.rhr.series.length) return 'rhr';
  if (p.sleep.series.length) return 'sleep';
  return p.feel ? 'feel' : 'rhr';
}

export function buildBodyPayload(input: {
  nights: WellnessNight[];
  today: string;
  /** workout_feedback rows, any order. */
  feedback: Array<{ feel?: number | null; difficulty?: number | null; created_at?: string | null }>;
}): BodyPayload {
  const { nights, today } = input;
  const rhrPanel = panel(nights, today, 'resting_hr');
  // The streak runs over the window and the morning shown, oldest first.
  const streak = rhrStreak(nights.filter(n => n.date <= today && n.date >= shiftDate(today, -RANGE_DAYS)), rhrPanel.range);
  const sleep = panel(nights, today, 'sleep_seconds');

  const answered = input.feedback
    .filter(f => f.feel != null && Number.isFinite(Number(f.feel)))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, FEEL_RUNS);
  const avg = feelAverage(answered, FEEL_RUNS);
  const efforts = answered.map(f => Number(f.difficulty)).filter(v => v >= 1 && v <= 10);
  const feel: FeelPanel | null = avg == null ? null : {
    avg,
    face: Math.max(0, Math.min(4, Math.round(avg))),
    effort: efforts.length ? Math.round((efforts.reduce((a, b) => a + b, 0) / efforts.length) * 10) / 10 : null,
    n: answered.length,
    recent: [...answered].reverse().map(f => ({
      date: String(f.created_at ?? '').slice(0, 10),
      feel: Math.max(0, Math.min(4, Math.round(Number(f.feel)))),
      difficulty: Number(f.difficulty) >= 1 && Number(f.difficulty) <= 10 ? Number(f.difficulty) : null,
    })),
  };

  const out = {
    rhr: { ...rhrPanel, streak, advice: rhrAdvice(streak, rhrPanel.range) },
    sleep,
    feel,
  };
  return { ...out, featured: featuredMetric(out) };
}

// ── The 30-day range chart (8) ─────────────────────────────────────────────────────────

export const RANGE_CHART = { width: 326, height: 120, padL: 26, padR: 12, padY: 6 } as const;

export interface RangeChartGeometry {
  width: number;
  height: number;
  /** The green band, P25…P75. */
  band: { y: number; h: number } | null;
  /** Two gridlines with their labels (HTML, never <text>). */
  grid: Array<{ y: number; value: number }>;
  /** `latest` is the big dot with the HTML flag: this morning, or the newest one stored. */
  dots: Array<{ x: number; y: number; date: string; value: number; out: boolean; latest: boolean }>;
  first: number;
  last: number;
}

/**
 * Thirty days, OLDEST LEFT and today on the right (G1). x is by day, so a missing morning
 * leaves a gap rather than closing up. `out` marks the dots that leave the band the bad
 * way — above for resting HR, below for sleep (orange); the good way stays grey.
 */
export function rangeChart(
  series: MetricPanel['series'],
  range: RangeResult,
  kind: 'rhr' | 'sleep',
  today: string,
  opts: { width?: number; height?: number } = {},
): RangeChartGeometry | null {
  if (!series.length) return null;
  const width = opts.width ?? RANGE_CHART.width;
  const height = opts.height ?? RANGE_CHART.height;
  const { padL, padR, padY } = RANGE_CHART;
  const from = shiftDate(today, -(RANGE_DAYS - 1));
  const learning = isLearning(range);
  // Sleep is drawn in minutes, so the gridlines can land on whole hours.
  const val = (v: number) => (kind === 'sleep' ? v / 60 : v);
  const step = kind === 'sleep' ? 60 : 5;
  const vs = series.map(p => val(p.value));
  if (!learning) vs.push(val(range.lo), val(range.hi));
  // A little air below, a little more above (room for the flag); gridlines on the round
  // values inside, the outer two kept (the mockup's 45 / 55 over 42…56).
  const lo = Math.min(...vs) - step * 0.4;
  const hi = Math.max(...vs) + step * 0.8;
  const y = (v: number) => padY + ((hi - v) / (hi - lo)) * (height - 2 * padY);
  const x = (date: string) => xAt(Math.round((Date.parse(date) - Date.parse(from)) / 86_400_000), RANGE_DAYS, width, padL, padR);

  const highLine = learning ? null : rhrHighLine(range);
  const grid: RangeChartGeometry['grid'] = [];
  for (let g = Math.ceil(lo / step) * step; g < hi; g += step) grid.push({ y: y(g), value: kind === 'sleep' ? g * 60 : g });
  const shown = grid.length > 2 ? [grid[0], grid[grid.length - 1]] : grid;

  return {
    width,
    height,
    band: learning ? null : { y: y(val(range.hi)), h: Math.max(2, y(val(range.lo)) - y(val(range.hi))) },
    grid: shown,
    dots: series.map((p, i) => ({
      x: x(p.date),
      y: y(val(p.value)),
      date: p.date,
      value: p.value,
      out: !learning && (kind === 'rhr' ? p.value > (highLine as number) : p.value < (range as { lo: number }).lo),
      latest: i === series.length - 1,
    })),
    first: kind === 'sleep' ? lo * 60 : lo,
    last: kind === 'sleep' ? hi * 60 : hi,
  };
}
