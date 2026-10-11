import { activityLocalDateStr, israelToday } from '@/lib/utils';
import { smoothPath, xAt } from '@/lib/charts/timeline';
import { bestSegmentSeconds, type LapLike } from '@/lib/prs/best-segment';
import { PR_BUCKETS, computeDistanceBests, filterQualifyingRuns } from '@/lib/prs/pr-buckets';
import { daysBetween, shiftDate } from './load';
import {
  dailyLoads, loadStatus, loadWeeks, pmcSeries, pmcToday, pointOn, projectSeries, weekStartOf,
  type DailyLoad, type LoadRow, type LoadStatus, type PmcPoint,
} from './pmc';
import { formBand, isHeavyWeek, rampWord, type FormBandKey, type RampWordKey } from './form-bands';
import { isLearning, type RangeResult, type WellnessNight } from './normal-range';
import { buildBodyPayload } from './body';
import {
  projectionVerdict, readinessGate, readinessHighlight, type GateReason, type Highlight,
} from './readiness';
import type { PaceSuggestionPayload } from './coach-tools-payload';

/**
 * The coach's readiness board (trainee-experience-v2 C1/C2, spec §3.6), pure: the rows a
 * route read go in, each trainee's readiness inputs come out — the numbers, the one
 * highlight, the 7-week spark, the gate on the pace-up suggestion — and C2's 8 weeks with
 * the dashed projection of what was planned.
 *
 * Every number is the trainee's own screens' number: the PMC is built here exactly as
 * load-payload.ts builds it (seeded at 0 on the first priced day, as of yesterday), and the
 * body numbers are body.ts's (`buildBodyPayload`), so a coach never sees a −11 where the
 * trainee sees −9.
 */

/** Points on the C1 spark: the last 7 Saturdays (the end of each plan week), then yesterday. */
export const SPARK_SATURDAYS = 7;
/** C2's chart: 8 weeks back from yesterday, one point a week. */
export const DETAIL_WEEKS = 8;
/** Feedback read for pain (the last 7 days) and feel (the newest 4 answers). */
export const FEEDBACK_DAYS = 28;
export const PAIN_DAYS = 7;
/** Wellness read: the 30-night range before the newest morning, plus a fortnight of streak. */
export const WELLNESS_DAYS = 44;

const r1 = (x: number) => Math.round(x * 10) / 10;
const RUN_SOURCES = new Set(['pace', 'pace_avg', 'hr', 'none']);

// ── The PMC, as the trainee's own screens build it ────────────────────────────────────

export interface Pmc {
  status: LoadStatus;
  /** Contiguous, oldest first, ending yesterday. Empty before the first priced day. */
  series: PmcPoint[];
  /** Rounded, as printed; null unless the status is ok (never a 0 that means "no data"). */
  today: { fitness: number; fatigue: number; form: number; ramp: number } | null;
  bandKey: FormBandKey | null;
  rampWordKey: RampWordKey | null;
  /** Last week's load above 1.15 × the 4 before it: "אחרי שבוע עמוס". */
  heavyLastWeek: boolean;
}

/**
 * `plannedByWeek` (plannedLoads over `plannedWeeksFor(today)`): the ramp word says "שבוע
 * קל" for a week the coach planned easy, exactly as the trainee's own screens do
 * (load-payload.ts) — the coach sees the same numbers and the same words.
 */
export function pmcOf(rows: LoadRow[], today: string, opts: { plannedByWeek?: Record<string, number | undefined> } = {}): Pmc {
  const status = loadStatus(rows, today);
  const priced = rows.filter(r => r.load != null && r.date <= today).map(r => r.date).sort();
  const first = priced[0] ?? null;
  const y = shiftDate(today, -1);
  const daily = first ? dailyLoads(rows, first, today) : [];
  const series = first && first <= y ? pmcSeries(daily.filter(d => d.date <= y)) : [];

  // The week before this one against the four before it (the home's "אחרי שבוע עמוס").
  const thisWeek = weekStartOf(today);
  const weekLoad = (start: string) => daily.reduce((s, d) => (d.date >= start && d.date <= shiftDate(start, 6) ? s + d.load : s), 0);
  const last = shiftDate(thisWeek, -7);
  const prev = [4, 3, 2, 1].map(k => shiftDate(last, -7 * k)).filter(w => first != null && shiftDate(w, 6) >= first).map(weekLoad);
  const heavyLastWeek = first != null && isHeavyWeek(weekLoad(last), prev);

  if (status.kind !== 'ok' || !series.length) {
    return { status, series, today: null, bandKey: null, rampWordKey: null, heavyLastWeek };
  }
  const t = pmcToday(series, today);
  const weeks = loadWeeks(daily, opts.plannedByWeek ?? {}, today, first);
  const now = weeks[weeks.length - 1];
  const easyWeek = !!now && now.weekStart === thisWeek && now.easy;
  return {
    status,
    series,
    today: { fitness: Math.round(t.fitness), fatigue: Math.round(t.fatigue), form: Math.round(t.form), ramp: Math.round(t.ramp) },
    bandKey: formBand(t.form).key,
    rampWordKey: rampWord(t.ramp, { easyWeek }).key,
    heavyLastWeek,
  };
}

/**
 * Fitness at each of the last 7 Saturdays and yesterday, oldest first (C1's spark: a line
 * that rises toward today is a trainee building). Only once the numbers mean something —
 * a trainee still being learned starts at 0 and would draw a climb that is not there.
 */
export function sparkOf(pmc: Pick<Pmc, 'status' | 'series'>, today: string): number[] {
  if (pmc.status.kind !== 'ok' || !pmc.series.length) return [];
  const y = shiftDate(today, -1);
  // The last Saturday strictly before yesterday (yesterday itself is the final point).
  const sat = shiftDate(weekStartOf(y), -1);
  const dates = [...Array.from({ length: SPARK_SATURDAYS }, (_, i) => shiftDate(sat, -7 * (SPARK_SATURDAYS - 1 - i))), y];
  return dates.filter(d => d >= pmc.series[0].date).map(d => r1(pointOn(pmc.series, d).fitness));
}

/** C2's chart: one point a week for 8 weeks, ending yesterday (= "היום" on the axis). */
export function weeklySeries(series: PmcPoint[], today: string, weeks = DETAIL_WEEKS): Array<{ date: string; fitness: number; fatigue: number }> {
  if (!series.length) return [];
  const y = shiftDate(today, -1);
  return Array.from({ length: weeks + 1 }, (_, i) => shiftDate(y, -7 * (weeks - i)))
    .filter(d => d >= series[0].date)
    .map(d => {
      const p = pointOn(series, d);
      return { date: d, fitness: r1(p.fitness), fatigue: r1(p.fatigue) };
    });
}

/** The C1 spark's box (mockup `.spark`: 64 × 30). */
export const SPARK = { width: 64, height: 30, padL: 3, padR: 4 } as const;

/**
 * The spark as a path: oldest LEFT, yesterday RIGHT (`xAt`), scaled to its own range with
 * 2 of air each side so a flat line stays a line, and the end dot. Null under 2 points.
 */
export function sparkGeometry(values: number[]): { path: string; end: { x: number; y: number } } | null {
  if (values.length < 2) return null;
  const mn = Math.min(...values) - 2;
  const mx = Math.max(...values) + 2;
  const n = values.length;
  const pts = values.map((v, i) => [xAt(i, n, SPARK.width, SPARK.padL, SPARK.padR), 3 + ((mx - v) / (mx - mn)) * 24] as [number, number]);
  const [x, y] = pts[n - 1];
  return { path: smoothPath(pts), end: { x, y } };
}

// ── A personal record on the last run (C1's "🏅 שיא ל־1 ק״מ היום") ─────────────────────

export interface RecordRun {
  id: string;
  start_time: string;
  activity_type?: string | null;
  distance: number;
  duration: number;
  laps?: LapLike[] | null;
}

/**
 * The buckets a record can be in, shortest first: the fastest kilometre inside a run (a
 * rep, mockup 5: "שיא חדש ל־1 ק״מ") and then the profile's PR buckets (lib/prs/pr-buckets,
 * 5K and up). The shortest wins the one line — a 5K "inside" a reps session is reps and
 * jogs, while the fastest rep is the record a coach means.
 */
export const RECORD_BUCKETS: ReadonlyArray<{ key: string; meters: number }> = [
  { key: '1k', meters: 1000 },
  ...PR_BUCKETS.map(b => ({ key: b.key, meters: b.meters })),
];

function bestIn(run: RecordRun, bucket: { key: string; meters: number }): number | null {
  if (bucket.key === '1k') return bestSegmentSeconds(run.laps, 1000);
  const found = computeDistanceBests(filterQualifyingRuns([run])).find(b => b.key === bucket.key);
  return found?.seconds ?? null;
}

/**
 * A record set today or yesterday: the run's best in a bucket beats every EARLIER run in
 * `season`, and an earlier one exists (a first 10K is a first, not a record). Newest run
 * first, shortest bucket first.
 */
export function recentRecord(recent: RecordRun[], season: RecordRun[], today: string): { bucket: string; daysAgo: number } | null {
  const runs = filterQualifyingRuns(recent)
    .map(r => ({ r, daysAgo: daysBetween(activityLocalDateStr(r.start_time), today) }))
    .filter(x => x.daysAgo === 0 || x.daysAgo === 1)
    .sort((a, b) => b.r.start_time.localeCompare(a.r.start_time));
  const pool = filterQualifyingRuns(season);
  for (const { r, daysAgo } of runs) {
    const earlier = pool.filter(o => o.id !== r.id && o.start_time < r.start_time);
    for (const bucket of RECORD_BUCKETS) {
      const mine = bestIn(r, bucket);
      if (mine == null) continue;
      const prev = earlier.map(o => bestIn(o, bucket)).filter((s): s is number => s != null);
      if (prev.length && mine < Math.min(...prev)) return { bucket: bucket.key, daysAgo };
    }
  }
  return null;
}

// ── One trainee's readiness ────────────────────────────────────────────────────────────

export interface FeedbackRow {
  feel?: number | null;
  difficulty?: number | null;
  pain?: boolean | null;
  created_at?: string | null;
}

export interface ReadinessInputs {
  status: LoadStatus;
  pmcToday: Pmc['today'];
  bandKey: FormBandKey | null;
  rampWordKey: RampWordKey | null;
  heavyLastWeek: boolean;
  spark: number[];
  rhr: {
    range: { lo: number; hi: number } | null;
    /** The newest morning within the window (this morning, or the latest synced). */
    today: number | null;
    isToday: boolean;
    streak: { flag: boolean; aboveRun: number };
  };
  sleep: { last: number | null; range: { lo: number; hi: number } | null };
  pain7: boolean;
  feelAvg4: number | null;
  /** The face the average rounds to, 0 (חלש מאוד) … 4 (חזק מאוד). */
  feelFace: number | null;
  effortAvg4: number | null;
  feelN: number;
  raceDays: number | null;
  raceName: string | null;
  daysSinceRun: number | null;
  prToday: { bucket: string; daysAgo: number } | null;
  gate: { paused: boolean; reasons: GateReason[] };
}

const rangeOf = (r: RangeResult) => (isLearning(r) ? null : { lo: Math.round(r.lo), hi: Math.round(r.hi) });

export function buildReadinessInputs(input: {
  rows: LoadRow[];
  nights: WellnessNight[];
  feedback: FeedbackRow[];
  race?: { name: string | null; date: string } | null;
  record?: { bucket: string; daysAgo: number } | null;
  today: string;
  /** Planned load per Sunday week (`plannedWeeksFor`), for the easy-week ramp word. */
  plannedByWeek?: Record<string, number | undefined>;
}): { inputs: ReadinessInputs; series: PmcPoint[] } {
  const { today } = input;
  const pmc = pmcOf(input.rows, today, { plannedByWeek: input.plannedByWeek });
  const body = buildBodyPayload({ nights: input.nights, today, feedback: input.feedback });

  const painFrom = shiftDate(today, -(PAIN_DAYS - 1));
  // `created_at` is a real instant (not an activity's local-as-UTC clock): its Israel day.
  const pain7 = input.feedback.some(f => f.pain === true && !!f.created_at && israelToday(new Date(f.created_at)) >= painFrom);

  const runs = input.rows.filter(r => RUN_SOURCES.has(r.source) && r.date <= today).map(r => r.date).sort();
  const lastRun = runs[runs.length - 1] ?? null;
  const raceDays = input.race?.date && input.race.date >= today ? daysBetween(today, input.race.date) : null;

  const gate = readinessGate({
    status: pmc.status.kind,
    form: pmc.today?.form ?? null,
    rhrFlag: body.rhr.streak.flag,
    painLast7: pain7,
    feelAvg4: body.feel?.avg ?? null,
  });

  return {
    series: pmc.series,
    inputs: {
      status: pmc.status,
      pmcToday: pmc.today,
      bandKey: pmc.bandKey,
      rampWordKey: pmc.rampWordKey,
      heavyLastWeek: pmc.heavyLastWeek,
      spark: sparkOf(pmc, today),
      rhr: {
        range: rangeOf(body.rhr.range),
        today: body.rhr.latest?.value ?? null,
        isToday: body.rhr.isToday,
        streak: body.rhr.streak,
      },
      sleep: { last: body.sleep.latest?.value ?? null, range: rangeOf(body.sleep.range) },
      pain7,
      feelAvg4: body.feel?.avg ?? null,
      feelFace: body.feel?.face ?? null,
      effortAvg4: body.feel?.effort ?? null,
      feelN: body.feel?.n ?? 0,
      raceDays,
      raceName: raceDays != null ? input.race?.name ?? null : null,
      daysSinceRun: lastRun ? daysBetween(lastRun, today) : null,
      prToday: input.record ?? null,
      gate,
    },
  };
}

// ── C1: the rows and the one alert ─────────────────────────────────────────────────────

export interface ReadinessRow {
  athleteId: string;
  name: string;
  initials: string;
  gender: string | null;
  form: number | null;
  bandKey: FormBandKey | null;
  status: LoadStatus;
  spark: number[];
  highlight: Highlight;
  weekDone: number;
  weekPlanned: number;
  paused: boolean;
}

export interface ReadinessAlert {
  athleteId: string;
  name: string;
  gender: string | null;
  reasons: GateReason[];
  /** Mornings above the range in the current run (the rule is 3). */
  aboveRun: number;
}

/** "Yoav Cohen" → "YC"; one word → its first two letters. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const severity = (reasons: GateReason[]) =>
  (reasons.includes('veryTired') ? 2 : 0) + (reasons.includes('rhr') ? 1 : 0);

/**
 * The ONE alert on top of C1: the most severe trainee the gate pauses for being very tired
 * and/or a resting HR above the range (pain and a weak feel are the coach's to read in the
 * thread, not a red card). Very tired + RHR beats very tired beats RHR; then the lower form.
 */
export function readinessAlert(
  trainees: Array<{ athleteId: string; name: string; gender: string | null }>,
  inputsBy: Record<string, ReadinessInputs | undefined>,
): ReadinessAlert | null {
  const ranked = trainees
    .map(t => ({ t, i: inputsBy[t.athleteId] }))
    .filter((x): x is { t: typeof x.t; i: ReadinessInputs } => !!x.i && severity(x.i.gate.reasons) > 0)
    .sort((a, b) => severity(b.i.gate.reasons) - severity(a.i.gate.reasons)
      || (a.i.pmcToday?.form ?? 0) - (b.i.pmcToday?.form ?? 0)
      || a.t.name.localeCompare(b.t.name, 'he'));
  const top = ranked[0];
  if (!top) return null;
  return {
    athleteId: top.t.athleteId,
    name: top.t.name,
    gender: top.t.gender,
    reasons: top.i.gate.reasons.filter(r => r === 'veryTired' || r === 'rhr'),
    aboveRun: top.i.rhr.streak.aboveRun,
  };
}

/**
 * C1's rows. The alert's trainee gets the NEXT fact as their line — the card on top
 * already says they are very tired with a high RHR (mockup: Yoav's row reads "כושר עלה 10,
 * מהר מדי" under the red card).
 */
export function readinessRows(
  trainees: Array<{ athleteId: string; name: string; gender: string | null }>,
  inputsBy: Record<string, ReadinessInputs | undefined>,
  weekBy: Record<string, { done: number; planned: number } | undefined>,
  alertId: string | null,
): ReadinessRow[] {
  return trainees.flatMap((t) => {
    const i = inputsBy[t.athleteId];
    if (!i) return [];
    const highlight = readinessHighlight({
      status: i.status.kind,
      form: i.pmcToday?.form ?? null,
      ramp: i.pmcToday?.ramp ?? null,
      rhrFlag: t.athleteId === alertId ? false : i.rhr.streak.flag,
      pr: i.prToday,
      race: i.raceDays != null ? { name: i.raceName, daysLeft: i.raceDays } : null,
      daysSinceRun: i.daysSinceRun,
    });
    const week = weekBy[t.athleteId];
    return [{
      athleteId: t.athleteId,
      name: t.name,
      initials: initialsOf(t.name),
      gender: t.gender,
      form: i.pmcToday?.form ?? null,
      bandKey: i.bandKey,
      status: i.status,
      spark: i.spark,
      highlight,
      weekDone: week?.done ?? 0,
      weekPlanned: week?.planned ?? 0,
      paused: i.gate.paused,
    }];
  });
}

// ── C2: the projection of the planned weeks ────────────────────────────────────────────

export interface Projection {
  /** The projected points the dashed line goes through: this Saturday and next (oldest first). */
  series: Array<{ date: string; fitness: number; fatigue: number }>;
  /** Next week's planned load (E2); null when next week has no plan yet. */
  nextWeekLoad: number | null;
  /** Form the morning after next Saturday: F − A at its end, rounded. */
  projectedForm: number;
  verdict: 'warn' | 'inRange' | 'room';
}

/**
 * "If he runs what you planned…": the series continued from today to the end of next week
 * over the planned loads — today's run as run when there is one, else as planned; the rest
 * of this week's sessions and next week's as planned (`plannedLoads`, the trainee's own row
 * or the club plan in their group, never another trainee's). A planned day already behind
 * us is not in it: the past is what was run. Null until the numbers mean something.
 */
export function projectionOf(input: {
  pmc: Pick<Pmc, 'status' | 'series'>;
  today: string;
  /** The load actually run today (null = not run yet). */
  ranToday: number | null;
  plannedByDate: Record<string, number>;
}): Projection | null {
  const { pmc, today } = input;
  if (pmc.status.kind !== 'ok' || !pmc.series.length) return null;
  const thisSat = shiftDate(weekStartOf(today), 6);
  const nextSun = shiftDate(thisSat, 1);
  const nextSat = shiftDate(thisSat, 7);
  const future: DailyLoad[] = [];
  for (let d = today; d <= nextSat; d = shiftDate(d, 1)) {
    const planned = input.plannedByDate[d] ?? 0;
    future.push({ date: d, load: d === today && input.ranToday != null ? input.ranToday : planned });
  }
  // From yesterday's point: the series ends yesterday, the future starts today.
  const projected = projectSeries(pmc.series, future);
  const at = (date: string) => projected.find(p => p.date === date)!;
  const dates = thisSat === today ? [nextSat] : [thisSat, nextSat];
  const end = at(nextSat);
  let next = 0;
  for (let d = nextSun; d <= nextSat; d = shiftDate(d, 1)) next += input.plannedByDate[d] ?? 0;
  const projectedForm = Math.round(end.fitness - end.fatigue);
  return {
    series: dates.map(d => ({ date: d, fitness: r1(at(d).fitness), fatigue: r1(at(d).fatigue) })),
    nextWeekLoad: next > 0 ? Math.round(next) : null,
    projectedForm,
    verdict: projectionVerdict(projectedForm),
  };
}

// ── The payloads of GET /api/academy/readiness ─────────────────────────────────────────

export interface ReadinessListResponse {
  today: string;
  /** Most tired first (`sortReadiness(…, 'tired')`); the board re-sorts on the phone. */
  rows: ReadinessRow[];
  alert: ReadinessAlert | null;
}

export interface ReadinessDetailResponse {
  today: string;
  athleteId: string;
  name: string;
  gender: string | null;
  status: LoadStatus;
  /** The three numbers, as of yesterday; null unless the status is ok. */
  numbers: (NonNullable<Pmc['today']> & { bandKey: FormBandKey; rampWordKey: RampWordKey; heavyLastWeek: boolean }) | null;
  /** 8 weeks, one point a week, ending yesterday ("היום"). */
  series: Array<{ date: string; fitness: number; fatigue: number }>;
  projection: Projection | null;
  feel: {
    face: number | null;
    effort: number | null;
    n: number;
    pain: boolean;
    weekDone: number;
    weekPlanned: number;
  };
  body: {
    rhr: { today: number | null; isToday: boolean; range: { lo: number; hi: number } | null; aboveRun: number; flag: boolean };
    sleep: { last: number | null; range: { lo: number; hi: number } | null };
  };
  pace: {
    /** The suggestion as the coach tools make it, with its readiness; null when there is none or it is held. */
    suggestion: PaceSuggestionPayload | null;
    /** The gate's reasons when a pace-up suggestion is being held. */
    held: GateReason[] | null;
    gate: { paused: boolean; reasons: GateReason[] };
  };
}
