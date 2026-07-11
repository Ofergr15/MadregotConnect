import { ParsedWorkout, WorkoutStep } from './ai/types';

/**
 * Canonical per-workout distance estimation, shared by the planner (WeekView /
 * WorkoutPreview) and the athlete dashboard so their weekly km ALWAYS agree.
 *
 * Priority:
 *   1. The coach's explicit per-day range (distanceMinKm / distanceMaxKm from
 *      the PDF header, e.g. "9 – 11 ק"מ") — this is the source of truth.
 *   2. Otherwise, estimate from the steps: distance steps count directly, and
 *      time steps are converted to distance using their target pace.
 *
 * Returns metres. Use `workoutDistanceMeters` for a single midpoint value, or
 * `workoutDistanceRangeMeters` when you need the min/max.
 */

const DEFAULT_PACE_MIN = 300; // sec/km — fallback fast bound for time->distance
const DEFAULT_PACE_MAX = 360; // sec/km — fallback slow bound

function estimateStepRangeMeters(step: WorkoutStep): { min: number; max: number } {
  if (step.repeatCount && step.repeatSteps) {
    let min = 0;
    let max = 0;
    for (const sub of step.repeatSteps) {
      const r = estimateStepRangeMeters(sub);
      min += r.min;
      max += r.max;
    }
    return { min: min * step.repeatCount, max: max * step.repeatCount };
  }

  if (step.durationType === 'distance' && step.durationValue) {
    return { min: step.durationValue, max: step.durationValue };
  }

  if (step.durationType === 'time' && step.durationValue) {
    const paceMin = step.targetPaceMinPerKm || DEFAULT_PACE_MIN;
    const paceMax = step.targetPaceMaxPerKm || DEFAULT_PACE_MAX;
    const timeSec = step.durationValue;
    // faster pace (smaller sec/km) => more distance
    const distMax = (timeSec / paceMin) * 1000;
    const distMin = (timeSec / paceMax) * 1000;
    return { min: Math.round(distMin), max: Math.round(distMax) };
  }

  return { min: 0, max: 0 };
}

/** Min/max distance in METRES for one workout. */
export function workoutDistanceRangeMeters(workout: ParsedWorkout): { min: number; max: number } {
  const coachMin = (workout as any).distanceMinKm as number | undefined;
  const coachMax = (workout as any).distanceMaxKm as number | undefined;
  if (coachMin || coachMax) {
    const min = (coachMin || coachMax || 0) * 1000;
    const max = (coachMax || coachMin || 0) * 1000;
    return { min, max };
  }
  let min = 0;
  let max = 0;
  for (const step of workout.steps) {
    const r = estimateStepRangeMeters(step);
    min += r.min;
    max += r.max;
  }
  return { min, max };
}

/** Midpoint distance in METRES for one workout (what most UIs show). */
export function workoutDistanceMeters(workout: ParsedWorkout): number {
  const { min, max } = workoutDistanceRangeMeters(workout);
  return Math.round((min + max) / 2);
}

/** Total midpoint distance in METRES across many workouts. */
export function totalDistanceMeters(workouts: ParsedWorkout[]): number {
  return workouts.reduce((sum, w) => sum + workoutDistanceMeters(w), 0);
}
