/**
 * Plan vs. Execution — the verdict on ONE run.
 *
 * Pure: no DB, no request, no React. `resolve.ts` feeds it plain objects and the
 * UI reads the result, so the same numbers reach a feed ring, a detail screen and
 * a push notification without three implementations drifting apart.
 *
 * It does not measure anything itself. Distance/duration/pace come from
 * `lib/academy/adherence.ts` and the per-rep verdicts from
 * `lib/academy/segments.ts` — both already in production for the academy
 * compliance screens. This module adds the two things those two don't answer:
 *
 *  1. DIRECTION. `adherence.ts` scores the SIZE of a deviation, not its sign, so
 *     a runner who ran every rep too fast and one who ran every rep too slow come
 *     out with the same number. Those are opposite coaching conversations, so the
 *     direction is a first-class field here and it — not the percentage — is what
 *     the UI leads with.
 *  2. ONE PERCENTAGE. `adherence.ts` scores the FRACTION of metrics that landed
 *     on target, which on a structured session is usually distance alone, i.e.
 *     0% or 100%. That is a pass/fail, and the ring is meant to read as accuracy.
 *     See `closeness` below.
 *
 * Units, as everywhere else in this app: distance METERS, duration SECONDS, pace
 * SECONDS PER KM (smaller = faster).
 */

import type {
  AdherenceTolerances,
  MetricStatus,
  PaceStatus,
  WorkoutAdherence,
} from '@/lib/academy/adherence';
import { DEFAULT_TOLERANCES } from '@/lib/academy/adherence';
import type { SegmentReport } from '@/lib/academy/segments';

/**
 * Which way the run missed — the headline.
 *
 * `mixed` is its own verdict rather than an average of the two: a session with
 * two reps far too fast and two far too slow is the single most useful thing a
 * coach can be told about pacing, and averaging the signs hides it completely.
 */
export type ExecutionDirection =
  | 'on_target'
  | 'too_fast'
  | 'too_slow'
  | 'mixed'
  | 'too_long'
  | 'too_short'
  | 'unknown';

export type ExecutionMetricKey = 'distance' | 'duration' | 'pace';

/**
 * Why a metric couldn't be graded. Shown to the athlete verbatim (as copy) —
 * a grey "not measured" with no reason reads as a bug, and every one of these
 * has a real reason that the engine already knows.
 */
export type ExecutionUnknownReason =
  /** The run itself has no such number. */
  | 'no_data'
  /**
   * The plan never asked for this metric. Distinct from `no_data`, which blames
   * the watch: an easy run with no prescribed pace has a perfectly good actual
   * pace sitting in the same row, so "the watch didn't record it" is a visible
   * lie.
   */
  | 'no_plan_value'
  /** The plan never stated a time, so the "planned" duration is our own guess. */
  | 'estimated_plan'
  /** A structured session's whole-run average pace answers nothing — see reps. */
  | 'structured_session';

export interface ExecutionMetric {
  key: ExecutionMetricKey;
  status: MetricStatus | PaceStatus;
  actual: number | null;
  plannedMin: number | null;
  plannedMax: number | null;
  /** 0..1, null when this metric wasn't graded. */
  closeness: number | null;
  /** Signed distance outside the tolerated band, in the metric's own unit. */
  deviation: number | null;
  reason: ExecutionUnknownReason | null;
}

export interface ExecutionRep {
  index: number;
  /** English label from segments.ts, e.g. "Interval 2km" / "Rest". */
  label: string;
  type: string;
  plannedPaceMin: number | null;
  plannedPaceMax: number | null;
  actualPace: number | null;
  actualDistanceM: number | null;
  status: PaceStatus;
  graded: boolean;
  /** Signed s/km outside the tolerated band; 0 when in band, null when ungraded. */
  deviation: number | null;
}

export interface ExecutionRepCounts {
  onTarget: number;
  faster: number;
  slower: number;
  unknown: number;
}

/** Where the percentage came from, so the UI can show its own arithmetic. */
export type ExecutionBasis = 'reps_and_metrics' | 'reps' | 'metrics';

export interface ExecutionVerdict {
  activityId: string;
  athleteId: string;
  /**
   * `unplanned` is a real answer, not a failure: a run nobody planned is not a
   * 0%. The academy compliance screens dropped these entirely, which is how an
   * athlete's own extra easy run could look like a missed workout.
   */
  status: 'graded' | 'ungraded' | 'unplanned';
  /** 0..100, integer. Null unless status === 'graded'. */
  score: number | null;
  direction: ExecutionDirection;
  /** Mean signed s/km outside the target band across the paces that were graded. */
  paceDeviationSec: number | null;
  workoutName: string | null;
  /** The coach's work band (sec/km) — what to SHOW, even when it wasn't graded. */
  paceBandMin: number | null;
  paceBandMax: number | null;
  metrics: ExecutionMetric[];
  reps: ExecutionRep[];
  repsAligned: boolean;
  /** Why there are no per-rep verdicts (straight from matchLapsToSteps). */
  repsReason: string | null;
  repCounts: ExecutionRepCounts;
  toleranceSec: number;
  basis: ExecutionBasis | null;
}

/**
 * How far outside the tolerance a value has to land before it scores zero,
 * expressed in tolerances. At 3: a rep 15 s/km outside a ±5 s/km band scores 0,
 * a rep 5 s/km outside scores 0.67.
 *
 * The number is a judgement call, so it's one named constant rather than an
 * expression buried in a formula: a session at triple the tolerance is not
 * "nearly right", and anything past that is equally not-the-workout.
 */
export const ZERO_AT_TOLERANCE_MULTIPLE = 3;

/**
 * 1 when inside the tolerated band, decaying linearly to 0 at
 * ZERO_AT_TOLERANCE_MULTIPLE tolerances outside it.
 *
 * This is the whole reason the ring can say 62% instead of "1 of 3 metrics".
 * `assessWorkout`'s own score counts metrics that landed on target, which on a
 * structured session is distance alone — one binary bit rendered as a
 * percentage. Accuracy is a distance, so it's measured as one.
 */
export function closeness(outside: number, tolerance: number): number {
  if (!(outside > 0)) return 1;
  if (!(tolerance > 0)) return 0;
  return Math.max(0, 1 - outside / (tolerance * ZERO_AT_TOLERANCE_MULTIPLE));
}

/**
 * Signed s/km OUTSIDE the tolerated pace band: negative = faster than asked,
 * positive = slower, 0 = in band. Mirrors `assessPace`'s bounds exactly, so a
 * status of 'on_target' always comes with a deviation of 0.
 */
export function paceDeviation(
  actual: number | null,
  min: number | null | undefined,
  max: number | null | undefined,
  toleranceSec: number,
): number | null {
  if (actual == null || min == null || max == null) return null;
  const lower = min - toleranceSec;
  const upper = max + toleranceSec;
  if (actual < lower) return actual - lower;
  if (actual > upper) return actual - upper;
  return 0;
}

/**
 * The same, for a ±fraction band (distance, duration). Returns the tolerance in
 * absolute units too, because `closeness` needs it and it depends on the band.
 */
export function rangeDeviation(
  actual: number | null,
  min: number,
  max: number,
  toleranceFraction: number,
): { deviation: number; tolerance: number } | null {
  if (actual == null || !(max > 0)) return null;
  const lower = min * (1 - toleranceFraction);
  const upper = max * (1 + toleranceFraction);
  if (actual < lower) return { deviation: actual - lower, tolerance: Math.max(min * toleranceFraction, 1) };
  if (actual > upper) return { deviation: actual - upper, tolerance: Math.max(max * toleranceFraction, 1) };
  return { deviation: 0, tolerance: Math.max(min * toleranceFraction, 1) };
}

/** Weight on the per-rep verdicts when a session has both reps and metrics. */
export const REPS_WEIGHT = 0.7;

const EMPTY_COUNTS: ExecutionRepCounts = { onTarget: 0, faster: 0, slower: 0, unknown: 0 };

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Why the pace row is grey on a session that clearly HAS a pace target.
 *
 * `assessWorkout` compares a whole-run average against `gradedPace*`, which
 * `computeGradedPaceBand` only sets for a run where one band covers ~all of it.
 * So a work band with no graded band means "structured session", which is not a
 * missing measurement — it's the same question, answered per rep instead.
 */
function paceUnknownReason(adherence: WorkoutAdherence): ExecutionUnknownReason {
  // Checked before the watch is blamed: on an easy run the plan simply never
  // prescribed a pace, and the row still shows the pace that WAS recorded.
  if (adherence.pace.plannedMin == null) return 'no_plan_value';
  if (adherence.pace.actual == null) return 'no_data';
  if (adherence.pace.comparedMin == null) return 'structured_session';
  return 'no_data';
}

function buildMetrics(
  adherence: WorkoutAdherence,
  tolerances: AdherenceTolerances,
): ExecutionMetric[] {
  const distanceRange = adherence.distance.status === 'unknown'
    ? null
    : rangeDeviation(
      adherence.distance.actual,
      adherence.distance.plannedMin,
      adherence.distance.plannedMax,
      tolerances.distance,
    );

  const durationRange = adherence.duration.status === 'unknown'
    ? null
    : rangeDeviation(
      adherence.duration.actual,
      adherence.duration.planned,
      adherence.duration.planned,
      tolerances.duration,
    );

  const paceDev = adherence.pace.status === 'unknown'
    ? null
    : paceDeviation(
      adherence.pace.actual,
      adherence.pace.comparedMin,
      adherence.pace.comparedMax,
      tolerances.paceSec,
    );

  return [
    {
      key: 'distance',
      status: adherence.distance.status,
      actual: adherence.distance.actual,
      plannedMin: adherence.distance.plannedMin || null,
      plannedMax: adherence.distance.plannedMax || null,
      closeness: distanceRange ? closeness(Math.abs(distanceRange.deviation), distanceRange.tolerance) : null,
      deviation: distanceRange ? Math.round(distanceRange.deviation) : null,
      reason: adherence.distance.status !== 'unknown'
        ? null
        : adherence.distance.plannedMin > 0 ? 'no_data' : 'no_plan_value',
    },
    {
      key: 'duration',
      status: adherence.duration.status,
      actual: adherence.duration.actual,
      plannedMin: adherence.duration.planned || null,
      plannedMax: adherence.duration.planned || null,
      closeness: durationRange ? closeness(Math.abs(durationRange.deviation), durationRange.tolerance) : null,
      deviation: durationRange ? Math.round(durationRange.deviation) : null,
      reason: adherence.duration.status !== 'unknown'
        ? null
        : adherence.duration.estimated ? 'estimated_plan' : 'no_data',
    },
    {
      key: 'pace',
      status: adherence.pace.status,
      actual: adherence.pace.actual,
      // The WORK band, not the band `status` was judged against — the athlete
      // was told "3:20-3:30", so that is what the row shows even when the
      // whole-run average couldn't fairly be compared to it.
      plannedMin: adherence.pace.plannedMin,
      plannedMax: adherence.pace.plannedMax,
      closeness: paceDev == null ? null : closeness(Math.abs(paceDev), tolerances.paceSec),
      deviation: paceDev == null ? null : Math.round(paceDev),
      reason: adherence.pace.status === 'unknown' ? paceUnknownReason(adherence) : null,
    },
  ];
}

function buildReps(report: SegmentReport | null, toleranceSec: number): ExecutionRep[] {
  if (!report) return [];
  return report.segments.map((segment) => ({
    index: segment.index,
    label: segment.label,
    type: segment.type,
    plannedPaceMin: segment.plannedPaceMin,
    plannedPaceMax: segment.plannedPaceMax,
    actualPace: segment.actualPace,
    actualDistanceM: segment.actualDistanceM,
    status: segment.status,
    graded: segment.graded,
    deviation: segment.status === 'unknown'
      ? null
      : paceDeviation(segment.actualPace, segment.plannedPaceMin, segment.plannedPaceMax, toleranceSec),
  }));
}

function countReps(reps: ExecutionRep[]): ExecutionRepCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const rep of reps) {
    if (!rep.graded) continue;
    if (rep.status === 'on_target') counts.onTarget++;
    else if (rep.status === 'faster') counts.faster++;
    else if (rep.status === 'slower') counts.slower++;
    else counts.unknown++;
  }
  return counts;
}

/**
 * Direction from a list of signed deviations, where 0 means "in band".
 *
 * All-zero is `on_target`; every non-zero the same way is that way; both ways is
 * `mixed`. Deliberately NOT "the sign of the mean": on the 4×2000 that decided
 * this design, four reps all ~13 s/km fast average out to a deviation that sits
 * inside the tolerance, so a mean-based reading calls a session where not one rep
 * was in band "on target".
 */
export function directionFromDeviations(deviations: number[]): ExecutionDirection | null {
  if (!deviations.length) return null;
  const missed = deviations.filter((d) => d !== 0);
  if (!missed.length) return 'on_target';
  if (missed.every((d) => d < 0)) return 'too_fast';
  if (missed.every((d) => d > 0)) return 'too_slow';
  return 'mixed';
}

export interface VerdictInput {
  activityId: string;
  athleteId: string;
  /** Null when no planned workout was matched to this run. */
  adherence: WorkoutAdherence | null;
  /** Null when the run has no stored laps, or they didn't line up with the plan. */
  segments: SegmentReport | null;
  tolerances?: AdherenceTolerances;
  workoutName?: string | null;
}

export function buildVerdict(input: VerdictInput): ExecutionVerdict {
  const tolerances = input.tolerances ?? DEFAULT_TOLERANCES;
  const { activityId, athleteId, adherence } = input;

  const base = {
    activityId,
    athleteId,
    toleranceSec: tolerances.paceSec,
  };

  if (!adherence || !adherence.completed) {
    return {
      ...base,
      status: 'unplanned',
      score: null,
      direction: 'unknown',
      paceDeviationSec: null,
      workoutName: input.workoutName ?? adherence?.name ?? null,
      paceBandMin: null,
      paceBandMax: null,
      metrics: [],
      reps: [],
      repsAligned: false,
      repsReason: null,
      repCounts: { ...EMPTY_COUNTS },
      basis: null,
    };
  }

  const metrics = buildMetrics(adherence, tolerances);
  const reps = buildReps(input.segments, tolerances.paceSec);
  const repCounts = countReps(reps);

  const repCloseness = reps
    .filter((rep) => rep.graded && rep.deviation != null)
    .map((rep) => closeness(Math.abs(rep.deviation as number), tolerances.paceSec));
  const metricCloseness = metrics
    .map((metric) => metric.closeness)
    .filter((value): value is number => value != null);

  const paceMetric = metrics.find((metric) => metric.key === 'pace');

  /**
   * A structured session whose reps could not be read is UNGRADED, not a 94%.
   *
   * The plan's entire content was per-rep paces. When none of them can be
   * checked, the only metric left is usually distance — and anyone who finished
   * the session covered the distance. Scoring that produced this feature's worst
   * possible output: a confident high accuracy for a session run at completely
   * the wrong pace, in the ring AND in the push notification.
   *
   * `structured_session` is precisely the signal for it: `adherence.ts` sets it
   * when a pace band was prescribed but no band covers enough of the run to grade
   * the average against, i.e. "this is an interval session, look at the reps".
   * With no reps to look at, the honest answer is no number.
   */
  const paceWasPrescribedButUnchecked =
    paceMetric?.reason === 'structured_session' && repCloseness.length === 0;

  const repPart = mean(repCloseness);
  const metricPart = mean(metricCloseness);
  const score01 = paceWasPrescribedButUnchecked
    ? null
    : repPart != null && metricPart != null
      ? REPS_WEIGHT * repPart + (1 - REPS_WEIGHT) * metricPart
      : repPart ?? metricPart;
  const basis: ExecutionBasis | null = score01 == null
    ? null
    : repPart != null && metricPart != null
      ? 'reps_and_metrics'
      : repPart != null ? 'reps' : metricPart != null ? 'metrics' : null;

  // Direction reads the reps when there are any — that IS the session. Only a
  // run with no per-rep verdicts falls back to its whole-run average pace, and
  // only a run with neither falls back to distance (ran long / ran short).
  const repDeviations = reps
    .filter((rep) => rep.graded && rep.deviation != null)
    .map((rep) => rep.deviation as number);
  const paceDeviations = repDeviations.length
    ? repDeviations
    : paceMetric?.deviation != null ? [paceMetric.deviation] : [];

  let direction = directionFromDeviations(paceDeviations);
  if (!direction) {
    const distance = metrics.find((metric) => metric.key === 'distance');
    if (distance?.deviation != null) {
      if (distance.deviation !== 0) {
        direction = distance.deviation > 0 ? 'too_long' : 'too_short';
      } else if (!paceWasPrescribedButUnchecked) {
        // Running long or short is worth saying either way. "Executed as
        // planned", though, is only earned when the distance was the whole plan —
        // saying it about an interval session whose paces we never read claims
        // the workout went right because the athlete covered the ground.
        direction = 'on_target';
      }
    }
  }

  return {
    ...base,
    status: score01 == null ? 'ungraded' : 'graded',
    score: score01 == null ? null : Math.round(score01 * 100),
    direction: direction ?? 'unknown',
    paceDeviationSec: paceDeviations.length ? Math.round(mean(paceDeviations) as number) : null,
    workoutName: input.workoutName ?? adherence.name ?? null,
    paceBandMin: adherence.pace.plannedMin,
    paceBandMax: adherence.pace.plannedMax,
    metrics,
    reps,
    repsAligned: input.segments?.aligned ?? false,
    repsReason: input.segments?.reason ?? null,
    repCounts,
    basis,
  };
}

/** A feed ring needs four fields, not the whole report. */
export interface ExecutionSummary {
  activityId: string;
  status: ExecutionVerdict['status'];
  score: number | null;
  direction: ExecutionDirection;
  workoutName: string | null;
}

export function toExecutionSummary(verdict: ExecutionVerdict): ExecutionSummary {
  return {
    activityId: verdict.activityId,
    status: verdict.status,
    score: verdict.score,
    direction: verdict.direction,
    workoutName: verdict.workoutName,
  };
}

// ── Presentation constants ──────────────────────────────────────────────────
// Colour lives here, next to the enum it keys off, because three surfaces render
// the same verdict (feed ring, detail header, coach board) and a direction that
// is blue in one and orange in another is worse than no colour at all.
//
// Straight out of the design tokens: brand blue for fast, band-3 orange for slow,
// the feedback screen's green for on target, accent-red for a session that swung
// both ways, ink-300 for nothing to say.

export const DIRECTION_COLOR: Record<ExecutionDirection, string> = {
  on_target: '#16a34a',
  too_fast: '#1525FF',
  too_slow: '#FF5315',
  mixed: '#AD3838',
  too_long: '#FF5315',
  too_short: '#159AFF',
  unknown: '#B9B9B9',
};

/** Ring fill for a score, when there is no direction to colour by. */
export const NEUTRAL_RING_COLOR = '#B9B9B9';

/**
 * Per-rep and per-metric pace verdicts. Same three colours as the directions
 * they aggregate into, so a chart of four blue reps and a blue "too fast"
 * headline are visibly the same statement.
 */
export const PACE_STATUS_COLOR: Record<PaceStatus, string> = {
  on_target: DIRECTION_COLOR.on_target,
  faster: DIRECTION_COLOR.too_fast,
  slower: DIRECTION_COLOR.too_slow,
  unknown: DIRECTION_COLOR.unknown,
};
