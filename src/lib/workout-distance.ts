import { ParsedWorkout } from './ai/types';
import {
  type EstimateOptions,
  type Estimate,
  planEstimateOptions,
  workoutDistanceEstimate,
} from './plans/step-estimate';

/**
 * Canonical per-workout distance, shared by the planner (WeekView /
 * WorkoutPreview), the athlete dashboard and the matcher's `expectedDistanceM`
 * so their weekly km ALWAYS agree.
 *
 * The arithmetic lives in `lib/plans/step-estimate.ts` — this file is the
 * distance-shaped door onto it, kept because half the app imports these three
 * names. Priority, in short:
 *
 *   1. The coach's own km range from the PDF header ("9 – 11 ק"מ").
 *   2. The steps: measured distances directly, times multiplied by their pace.
 *   3. A time stated only in the coach's note ("70-80 דק׳"), also multiplied.
 *
 * Pass `opts` from `planEstimateOptions(week)` when the whole week is in hand:
 * an unpaced easy run is then priced at the pace band this coach actually
 * writes rather than a global assumption.
 */

export { planEstimateOptions } from './plans/step-estimate';
export type { EstimateOptions, Estimate, Provenance } from './plans/step-estimate';

/** Min/max distance in METRES for one workout, with where the figure came from. */
export function workoutDistanceEstimated(
  workout: ParsedWorkout,
  opts?: EstimateOptions,
): Estimate {
  return workoutDistanceEstimate(workout, opts);
}

/** Min/max distance in METRES for one workout. */
export function workoutDistanceRangeMeters(
  workout: ParsedWorkout,
  opts?: EstimateOptions,
): { min: number; max: number } {
  return workoutDistanceEstimate(workout, opts).range;
}

/** Midpoint distance in METRES for one workout (what most UIs show). */
export function workoutDistanceMeters(workout: ParsedWorkout, opts?: EstimateOptions): number {
  const { min, max } = workoutDistanceRangeMeters(workout, opts);
  return Math.round((min + max) / 2);
}

/**
 * Total midpoint distance in METRES across many workouts.
 *
 * Derives the week's own easy pace band first, since it has the week to derive
 * it from — the estimated part of the total is otherwise priced at a pace this
 * coach never prescribes.
 */
export function totalDistanceMeters(workouts: ParsedWorkout[], opts?: EstimateOptions): number {
  const tuned = planEstimateOptions(workouts, opts);
  return workouts.reduce((sum, w) => sum + workoutDistanceMeters(w, tuned), 0);
}
