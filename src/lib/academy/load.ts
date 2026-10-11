import type { WorkoutStep } from '@/lib/ai/types';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';
import { stepPaceBand, stepTimeRange, type EstimateOptions } from '@/lib/plans/step-estimate';
import { activityLocalDateStr } from '@/lib/utils';

/**
 * The load of a run (⚡ עומס), our rTSS — spec §3.1, mockup 5ב.
 *
 *   load = 100 × Σ (t_h × IF²),   IF = T / pace   (T = threshold pace, sec/km)
 *
 * One hour at threshold pace is 100. Every number the trainee screens show — the ⚡ on a
 * workout, fitness, fatigue, form, the weekly bars — is read off this one figure per
 * activity, so it is pure and has no clock: the date a run is priced against comes from
 * the run, and the test from the caller.
 *
 * The threshold is the test valid ON THE RUN'S DATE (`thresholdOn`), never today's: a new
 * test re-prices only what came after it. Without one, heart rate stands in (`hrLoad`,
 * marked "הערכה לפי דופק"); without either there is no load at all — never a 0.
 */

/** Bump when the arithmetic changes: every stored row below it is stale and re-priced. */
export const LOAD_VERSION = 1;

/** IF clamp. A GPS spike lap at 2:00/km must not price like a world record. */
export const IF_MIN = 0.4;
export const IF_MAX = 1.4;

/** Slower than 12:00/km is walking or a stopped GPS, not running: the segment is dropped. */
export const WALK_PACE_SEC = 720;

/** A segment shorter than this is a double press of the lap button. */
export const MIN_SEGMENT_M = 50;

/** LTHR as a share of max HR (spec §3.1). */
export const LTHR_SHARE = 0.89;

/** A hard ceiling, the migration's CHECK: a corrupt 30-hour "run" is not a load. */
export const LOAD_MAX = 2000;

/** Max HR comes from this many days before the run, and needs this many runs carrying it. */
export const MAX_HR_DAYS = 180;
export const MAX_HR_MIN_RUNS = 3;

export type LoadSource = 'pace' | 'pace_avg' | 'hr' | 'none' | 'not_run';

/** One stretch of a run priced on its own. `sec` is moving time. */
export interface LoadSegment {
  sec: number;
  paceSec: number;
  distM: number;
  hr?: number;
  /** The watch's workout step this lap executed (Garmin `wktStepIndex`), when it has one. */
  step?: number;
  /** Garmin's per-lap marker (WARMUP, ACTIVE, RECOVERY, COOLDOWN…), with `step` only. */
  intensity?: string;
  label?: string;
}

/** A usable test, already filtered (loadTestsFor): its date and its threshold pace. */
export interface TestPoint {
  date: string;
  thresholdSec: number;
}

/** The athlete_activities columns the engine reads. */
export interface LoadActivity {
  start_time: string;
  activity_type?: string | null;
  distance?: number | null;
  duration?: number | null;
  moving_duration?: number | null;
  average_hr?: number | null;
  max_hr?: number | null;
  laps?: unknown;
  splits?: unknown;
}

export interface LoadResult {
  load: number | null;
  source: LoadSource;
  thresholdSec: number | null;
  /** The test valid on the run's date, whatever priced it — the stale rule compares it. */
  basisTestDate: string | null;
}

const RUN_TYPES = new Set(PR_RUN_TYPES);

/**
 * Is this a run? The same list PRs, weekly km and the leaderboards use (pr-buckets.ts).
 * An untyped activity counts as a run there too.
 */
export function isRunType(type: string | null | undefined): boolean {
  return !type || RUN_TYPES.has(type);
}

const clampIf = (x: number) => Math.min(IF_MAX, Math.max(IF_MIN, x));

/**
 * The run as segments, finest first, with walking and lap-button noise dropped.
 *
 * Laps when they are finer than the per-km splits (an interval session's laps are its
 * reps), or whenever the watch tied them to workout steps; else the splits; else one
 * segment at the moving average — `pace_avg`, which flattens intervals and so is an
 * estimate.
 */
export function segmentsFromActivity(act: LoadActivity): { segments: LoadSegment[]; kind: 'pace' | 'pace_avg' } {
  const laps = normalizeStoredLaps(act.laps);
  const splits = normalizeStoredLaps(act.splits);
  const structured = laps.some(l => l.wktStepIndex != null);
  const chosen = structured || laps.length >= splits.length ? laps : splits;
  if (chosen.length) {
    const segments: LoadSegment[] = [];
    for (const l of chosen) {
      const sec = l.movingDuration && l.movingDuration > 0 ? l.movingDuration : l.duration;
      if (!(l.distance >= MIN_SEGMENT_M) || !(sec > 0)) continue;
      const paceSec = sec / (l.distance / 1000);
      if (paceSec > WALK_PACE_SEC) continue;
      const seg: LoadSegment = { sec, paceSec, distM: l.distance };
      if (l.averageHR) seg.hr = l.averageHR;
      if (l.wktStepIndex != null) seg.step = l.wktStepIndex;
      if (l.intensityType) seg.intensity = l.intensityType;
      segments.push(seg);
    }
    if (segments.length) return { segments, kind: 'pace' };
  }
  const distM = Number(act.distance) || 0;
  const sec = Number(act.moving_duration) > 0 ? Number(act.moving_duration) : Number(act.duration) || 0;
  if (distM >= MIN_SEGMENT_M && sec > 0) {
    const paceSec = sec / (distM / 1000);
    if (paceSec <= WALK_PACE_SEC) {
      const seg: LoadSegment = { sec, paceSec, distM };
      if (Number(act.average_hr) > 0) seg.hr = Number(act.average_hr);
      return { segments: [seg], kind: 'pace_avg' };
    }
  }
  return { segments: [], kind: 'pace_avg' };
}

/**
 * The test valid on `date`: the newest one dated on or before it. `tests` are already the
 * usable ones (approved, not excluded, 30-minute — the `loadTestBasis` rule), so load and
 * the paces in the plan always stand on the same test. Never a test from after the run.
 */
export function thresholdOn(date: string, tests: TestPoint[]): TestPoint | null {
  let best: TestPoint | null = null;
  for (const t of tests) {
    if (!(t.thresholdSec > 0) || t.date > date) continue;
    if (!best || t.date > best.date) best = t;
  }
  return best;
}

/** One segment's raw load at threshold `T`. */
function paceSegmentLoad(seg: LoadSegment, T: number): number {
  const f = clampIf(T / seg.paceSec);
  return 100 * (seg.sec / 3600) * f * f;
}

/** Σ of the segments at threshold pace `T`, unrounded. */
export function paceLoad(segments: LoadSegment[], T: number): number {
  if (!(T > 0)) return 0;
  return segments.reduce((sum, s) => sum + paceSegmentLoad(s, T), 0);
}

export interface HrBasis {
  /** Resting HR: the 30-day median of the stored mornings. */
  rhr: number;
  maxHr: number;
}

/** LTHR ≈ 0.89 × max HR. */
export function lthrOf(maxHr: number): number {
  return LTHR_SHARE * maxHr;
}

function hrSegmentLoad(seg: { sec: number; hr?: number }, basis: HrBasis): number {
  const lthr = lthrOf(basis.maxHr);
  if (!seg.hr || !(lthr > basis.rhr)) return 0;
  const f = clampIf((seg.hr - basis.rhr) / (lthr - basis.rhr));
  return 100 * (seg.sec / 3600) * f * f;
}

/** The heart-rate fallback: IF = (HR − RHR) / (LTHR − RHR), same formula, unrounded. */
export function hrLoad(segments: Array<{ sec: number; hr?: number }>, basis: HrBasis): number {
  return segments.reduce((sum, s) => sum + hrSegmentLoad(s, basis), 0);
}

/**
 * Max HR as of `asOf`: the highest `max_hr` over the runs of the previous 180 days, once
 * at least 3 of them carry one (a single strap glitch is not a max). Null otherwise.
 */
export function maxHrOf(
  acts: Array<{ date: string; maxHr?: number | null; type?: string | null }>,
  asOf: string,
): number | null {
  const from = shiftDate(asOf, -MAX_HR_DAYS);
  let n = 0;
  let max = 0;
  for (const a of acts) {
    if (!isRunType(a.type) || !(Number(a.maxHr) > 0) || a.date > asOf || a.date < from) continue;
    n += 1;
    max = Math.max(max, Number(a.maxHr));
  }
  return n >= MAX_HR_MIN_RUNS ? max : null;
}

/** The segments for the HR fallback: laps that carry HR, else the whole run at its average. */
function hrSegments(act: LoadActivity, segments: LoadSegment[]): Array<{ sec: number; hr?: number }> {
  const withHr = segments.filter(s => s.hr);
  if (withHr.length) return withHr;
  const sec = Number(act.moving_duration) > 0 ? Number(act.moving_duration) : Number(act.duration) || 0;
  const hr = Number(act.average_hr) || 0;
  return sec > 0 && hr > 0 ? [{ sec, hr }] : [];
}

export interface LoadContext {
  tests: TestPoint[];
  /** Resting HR for the HR fallback, or null when no mornings are stored. */
  rhr: number | null;
  /** `maxHrOf` as of the run's date, or null. */
  maxHr: number | null;
}

const roundLoad = (x: number) => Math.min(LOAD_MAX, Math.max(0, Math.round(x)));

/**
 * The load of one activity: pace against the test valid that day, else heart rate, else
 * nothing. A non-run is `not_run` and never priced.
 */
export function activityLoad(act: LoadActivity, ctx: LoadContext): LoadResult {
  if (!isRunType(act.activity_type)) {
    return { load: null, source: 'not_run', thresholdSec: null, basisTestDate: null };
  }
  const date = activityLocalDateStr(act.start_time);
  const test = thresholdOn(date, ctx.tests);
  const basisTestDate = test?.date ?? null;
  const { segments, kind } = segmentsFromActivity(act);
  if (test && segments.length) {
    return { load: roundLoad(paceLoad(segments, test.thresholdSec)), source: kind, thresholdSec: test.thresholdSec, basisTestDate };
  }
  if (ctx.rhr && ctx.maxHr) {
    const hrSegs = hrSegments(act, segments);
    if (hrSegs.length) {
      return { load: roundLoad(hrLoad(hrSegs, { rhr: ctx.rhr, maxHr: ctx.maxHr })), source: 'hr', thresholdSec: null, basisTestDate };
    }
  }
  return { load: null, source: 'none', thresholdSec: null, basisTestDate };
}

// ── Planned load (E2) ──────────────────────────────────────────────────────────────────

const mid = (r: { min: number; max: number }) => (r.min + r.max) / 2;

const isJog = (step: WorkoutStep) => step.type === 'recovery' || step.type === 'rest';

/**
 * A plan's steps restated by `scale` (the trainee's threshold ÷ the one the paces were
 * written for — week-board's `toTrainee`): a club week's steps carry a squad lane's paces,
 * and priced as stored, a beginner's ⚡ would be the lane's session against their own
 * threshold. Only the pace fields move; a distance step's time follows from them. Scale 1
 * (or none) hands the same array back.
 */
export function restateSteps(steps: WorkoutStep[] | null | undefined, scale = 1): WorkoutStep[] {
  if (!steps?.length) return [];
  if (!(scale > 0) || Math.abs(scale - 1) < 1e-9) return steps;
  const at = (sec: number | undefined) => (sec && sec > 0 ? Math.round(sec * scale) : sec);
  const one = (step: WorkoutStep): WorkoutStep => ({
    ...step,
    ...(step.targetPaceMinPerKm ? { targetPaceMinPerKm: at(step.targetPaceMinPerKm) } : {}),
    ...(step.targetPaceMaxPerKm ? { targetPaceMaxPerKm: at(step.targetPaceMaxPerKm) } : {}),
    ...(step.repeatSteps?.length ? { repeatSteps: step.repeatSteps.map(one) } : {}),
  });
  return steps.map(one);
}

/** The estimate options' fallback bands restated by the same `scale`. */
export function restateOptions(opts: EstimateOptions = {}, scale = 1): EstimateOptions {
  if (!(scale > 0) || Math.abs(scale - 1) < 1e-9) return opts;
  const band = (r?: { min: number; max: number }) => (r ? { min: r.min * scale, max: r.max * scale } : undefined);
  return {
    ...opts,
    ...(opts.easyBand ? { easyBand: band(opts.easyBand) } : {}),
    ...(opts.recoveryBand ? { recoveryBand: band(opts.recoveryBand) } : {}),
  };
}

/** One leaf step of a plan as run: how many times, and each time's seconds and pace. */
export interface PlannedLeg {
  step: WorkoutStep;
  times: number;
  sec: number;
  paceSec: number;
}

/**
 * The plan's leaf steps, each at the midpoint of its time (distance × pace for a km step)
 * and of its pace band — the estimator every other plan figure uses (lib/plans/
 * step-estimate.ts). A repeat's trailing jog is BETWEEN the reps (mockup 1/4: "5 × 1 ק״מ"
 * draws four jogs, "בין החזרות"), so it counts one time fewer than the reps; the card's
 * minutes, the plan column of screen 5 and the ⚡ are all read off these legs.
 */
export function plannedLegs(steps: WorkoutStep[] | null | undefined, opts: EstimateOptions = {}): PlannedLeg[] {
  const out: PlannedLeg[] = [];
  const leaf = (step: WorkoutStep, times: number) => {
    if (!(times > 0)) return;
    const time = stepTimeRange(step, opts);
    if (time.from === 'none') return;
    const sec = mid(time.range);
    const paceSec = mid(stepPaceBand(step, opts).range);
    if (!(sec > 0) || !(paceSec > 0)) return;
    out.push({ step, times, sec, paceSec });
  };
  const visit = (step: WorkoutStep, times: number) => {
    if (step.repeatCount && step.repeatSteps?.length) {
      const subs = step.repeatSteps;
      subs.forEach((sub, j) => {
        const between = j === subs.length - 1 && subs.length > 1 && isJog(sub) && !sub.repeatCount;
        visit(sub, times * (between ? step.repeatCount! - 1 : step.repeatCount!));
      });
      return;
    }
    leaf(step, times);
  };
  for (const step of steps ?? []) visit(step, 1);
  return out;
}

/** The planned session's distance and moving time, from `plannedLegs`. */
export function plannedTotals(steps: WorkoutStep[] | null | undefined, opts: EstimateOptions = {}): { distanceM: number; durationSec: number } {
  let distanceM = 0;
  let durationSec = 0;
  for (const l of plannedLegs(steps, opts)) {
    durationSec += l.times * l.sec;
    distanceM += l.times * (l.sec / l.paceSec) * 1000;
  }
  return { distanceM: Math.round(distanceM), durationSec: Math.round(durationSec) };
}

/** The same formula over a planned workout's legs (`plannedLegs`). Unrounded. */
export function plannedLoad(steps: WorkoutStep[] | null | undefined, T: number, opts: EstimateOptions = {}): number {
  if (!(T > 0) || !steps?.length) return 0;
  return plannedLegs(steps, opts).reduce((sum, l) => {
    const f = clampIf(T / l.paceSec);
    return sum + l.times * 100 * (l.sec / 3600) * f * f;
  }, 0);
}

// ── The 5ב breakdown ───────────────────────────────────────────────────────────────────

export type PartKind = 'warmup' | 'work' | 'jog' | 'cooldown' | 'run';

/** A group of segments the sheet prints as one line. */
export interface SegmentGroup {
  kind: PartKind;
  idx: number[];
}

export interface LoadPart {
  labelKey: string;
  params: { count: number; distM: number; sec: number; km: number; paceSec: number };
  load: number;
}

/** A segment at or above this IF is work; below it is warmup, jog or cooldown by position. */
export const WORK_IF = 0.88;

const INTENSITY_KIND: Record<string, PartKind> = {
  WARMUP: 'warmup', COOLDOWN: 'cooldown', RECOVERY: 'jog', REST: 'jog', ACTIVE: 'work', INTERVAL: 'work',
};

/**
 * Which part of the session each segment was. By the watch's workout step when the laps
 * carry one (one line per step, reps of a repeat together), else by pace tone: work is at
 * or above `WORK_IF`, the easy running before the first work is warmup, after the last is
 * cooldown, in between is the jog. A run with no work at all is one line.
 *
 * `intensityOf(seg)` is the segment's IF, so the HR fallback groups by heart rate.
 */
export function groupSegments(segments: LoadSegment[], intensityOf: (s: LoadSegment) => number): SegmentGroup[] {
  if (!segments.length) return [];
  const isWork = segments.map(s => intensityOf(s) >= WORK_IF);
  const first = isWork.indexOf(true);
  const last = isWork.lastIndexOf(true);
  const toneOf = (i: number): PartKind =>
    first < 0 ? 'run' : isWork[i] ? 'work' : i < first ? 'warmup' : i > last ? 'cooldown' : 'jog';

  if (segments.every(s => s.step != null)) {
    const byStep = new Map<number, SegmentGroup>();
    const order: SegmentGroup[] = [];
    segments.forEach((s, i) => {
      let g = byStep.get(s.step!);
      if (!g) {
        g = { kind: (s.intensity && INTENSITY_KIND[s.intensity.toUpperCase()]) || toneOf(i), idx: [] };
        byStep.set(s.step!, g);
        order.push(g);
      }
      g.idx.push(i);
    });
    return order;
  }

  const groups = new Map<PartKind, SegmentGroup>();
  const order: SegmentGroup[] = [];
  segments.forEach((_, i) => {
    const kind = toneOf(i);
    let g = groups.get(kind);
    if (!g) {
      g = { kind, idx: [] };
      groups.set(kind, g);
      order.push(g);
    }
    g.idx.push(i);
  });
  return order;
}

/**
 * Integers that sum to the rounded total: floor each, then hand the missing units to the
 * largest remainders. Ties go to the earlier part.
 */
export function largestRemainder(raw: number[]): number[] {
  const total = Math.round(raw.reduce((a, b) => a + b, 0));
  const floors = raw.map(Math.floor);
  let missing = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (missing <= 0) break;
    floors[i] += 1;
    missing -= 1;
  }
  return floors;
}

/**
 * The 5ב lines: each group's load, rounded so the parts add up to the total the ⚡ shows
 * (10 + 37 + 6 + 11 = 64). `basis` is the threshold pace, or the HR basis for an HR load.
 */
export function loadParts(segments: LoadSegment[], basis: number | HrBasis, groups: SegmentGroup[]): LoadPart[] {
  const price = (s: LoadSegment) => (typeof basis === 'number' ? paceSegmentLoad(s, basis) : hrSegmentLoad(s, basis));
  const raw = groups.map(g => g.idx.reduce((sum, i) => sum + price(segments[i]), 0));
  const rounded = largestRemainder(raw);
  return groups.map((g, k) => {
    const segs = g.idx.map(i => segments[i]);
    const sec = segs.reduce((a, s) => a + s.sec, 0);
    const distM = segs.reduce((a, s) => a + s.distM, 0);
    return {
      labelKey: `trainee.loadSheet.part.${g.kind}`,
      params: {
        count: segs.length,
        distM: Math.round(distM / segs.length),
        sec: Math.round(sec / segs.length),
        km: Math.round(distM / 100) / 10,
        paceSec: distM > 0 ? Math.round(sec / (distM / 1000)) : 0,
      },
      load: rounded[k],
    };
  });
}

/**
 * The 5ב lines of a PLANNED workout (screen 4's "⚡ עומס צפוי"), one per step of the plan:
 * a repeat's work and its recovery as two lines ("5 × 1000", "4 × 2:00"), the warmup and
 * the cooldown as one each. Priced exactly as `plannedLoad` (the same legs), then rounded
 * so the lines add up to the number on the ⚡.
 */
export function plannedParts(steps: WorkoutStep[] | null | undefined, T: number, opts: EstimateOptions = {}): LoadPart[] {
  if (!(T > 0) || !steps?.length) return [];
  const kindOf = (step: WorkoutStep, f: number): PartKind => {
    if (step.type === 'warmup') return 'warmup';
    if (step.type === 'cooldown') return 'cooldown';
    if (isJog(step)) return 'jog';
    return f >= WORK_IF || step.type === 'interval' ? 'work' : 'run';
  };
  const parts = plannedLegs(steps, opts).map((l) => {
    const f = clampIf(T / l.paceSec);
    return {
      kind: kindOf(l.step, f), raw: l.times * 100 * (l.sec / 3600) * f * f, count: l.times, sec: l.sec,
      distM: (l.sec / l.paceSec) * 1000,
    };
  });
  const rounded = largestRemainder(parts.map(p => p.raw));
  return parts.map((p, k) => ({
    labelKey: `trainee.loadSheet.part.${p.kind}`,
    params: {
      count: p.count,
      distM: Math.round(p.distM),
      sec: Math.round(p.sec),
      km: Math.round((p.distM * p.count) / 100) / 10,
      paceSec: p.distM > 0 ? Math.round(p.sec / (p.distM / 1000)) : 0,
    },
    load: rounded[k],
  }));
}

/** The IF of one segment against a pace or an HR basis — what `groupSegments` sorts by. */
export function intensityOf(basis: number | HrBasis): (s: LoadSegment) => number {
  if (typeof basis === 'number') return (s) => clampIf(basis / s.paceSec);
  const lthr = lthrOf(basis.maxHr);
  return (s) => (s.hr && lthr > basis.rhr ? clampIf((s.hr - basis.rhr) / (lthr - basis.rhr)) : 0);
}

export interface ActivityBreakdown extends LoadResult {
  parts: LoadPart[];
}

/**
 * The 5ב sheet: the activity's load and the lines it is made of, grouped by workout step
 * or by pace tone, priced with the same basis the load used (so the parts sum to it).
 * `pace_avg` is one line; `none` and `not_run` have none.
 */
export function activityBreakdown(act: LoadActivity, ctx: LoadContext): ActivityBreakdown {
  const result = activityLoad(act, ctx);
  if (result.load == null) return { ...result, parts: [] };
  const { segments } = segmentsFromActivity(act);
  if (result.source === 'pace' || result.source === 'pace_avg') {
    const T = result.thresholdSec!;
    const groups = result.source === 'pace_avg'
      ? [{ kind: 'run' as PartKind, idx: segments.map((_, i) => i) }]
      : groupSegments(segments, intensityOf(T));
    return { ...result, parts: loadParts(segments, T, groups) };
  }
  // HR: the laps that carry heart rate, grouped by it; a run with only an average is one line.
  const basis: HrBasis = { rhr: ctx.rhr!, maxHr: ctx.maxHr! };
  const withHr = segments.filter(s => s.hr);
  if (!withHr.length) {
    const sec = Number(act.moving_duration) > 0 ? Number(act.moving_duration) : Number(act.duration) || 0;
    const distM = Number(act.distance) || 0;
    const one: LoadSegment = { sec, paceSec: distM > 0 ? sec / (distM / 1000) : 0, distM, hr: Number(act.average_hr) };
    return { ...result, parts: loadParts([one], basis, [{ kind: 'run', idx: [0] }]) };
  }
  return { ...result, parts: loadParts(withHr, basis, groupSegments(withHr, intensityOf(basis))) };
}

// ── Dates (no clock: plain calendar arithmetic on YYYY-MM-DD) ──────────────────────────

/** `date` shifted by `days`, as YYYY-MM-DD. UTC arithmetic, so no DST edge. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}
