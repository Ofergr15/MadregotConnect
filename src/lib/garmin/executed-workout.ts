/**
 * The workout the DEVICE ran, from `GET /activity-service/activity/{id}/workouts`.
 *
 * This is the missing half of `wktStepIndex`. The laps say "this stretch was step 3";
 * only the workout the watch was actually given says what step 3 was. Reading the lap
 * index against our own parsed plan instead looks like it works and quietly doesn't:
 *
 *  - One athlete's Sunday came off a workout of their own — a single open 22 km step
 *    where the club's plan has a 2 km warm-up and a 20 km block. Every index was in
 *    range, so nothing looked wrong, and the verdict read "warm-up: 22 km".
 *  - Garmin numbers a FLAT step list that includes the repeat markers. A workout with
 *    three repeated sets has markers at 10, 13 and 17, and a walk of our plan that
 *    collapses repeats numbers everything after the first marker one too low.
 *
 * Both disappear when the numbering comes from the same list the watch numbered.
 *
 * Two things about the payload that shape everything here:
 *
 *  - **A repeat is a marker step, not a container.** `durationType:
 *    'REPEAT_UNTIL_STEPS_CMPLT'` with `durationValue` = the stepIndex to go back to
 *    and `targetValue` = how many times. Its children are listed once, before it, and
 *    keep their own indices across every iteration — eight strides are eight laps all
 *    stamped with the same index. The marker itself never appears in a lap.
 *  - **The pace target is usually prose.** One workout in eight carries a machine
 *    target (`targetType: 'SPEED'`, m/s); the rest carry the coach's own note —
 *    "4:25 (4:35) ((4:45))" for the three lanes, "5:00-5:30" for everybody. So the
 *    note is not a comment to display, it is the target to grade against.
 */

import { lanePaceFromNotes } from '../ai/splitGroups';
import type { Lane } from '../academy/group-lane';

export interface ExecutedStep {
  /** What a lap's `wktStepIndex` points at. Position in the flat list, markers included. */
  stepIndex: number;
  /** WARMUP / ACTIVE / INTERVAL / REST / RECOVERY / COOLDOWN — null on a repeat marker. */
  intensity: string | null;
  /** DISTANCE | TIME | OPEN | REPEAT_UNTIL_STEPS_CMPLT | … */
  durationType: string;
  /** Set when the step ends at a distance. */
  distanceM?: number;
  /** Set when the step ends at a time. */
  durationSec?: number;
  /** sec/km, only from a machine target. The note usually carries it instead. */
  paceMin?: number;
  paceMax?: number;
  /** The coach's text for this step, verbatim — the target, most of the time. */
  notes?: string;
  /** On a repeat marker: the stepIndex the set goes back to. */
  repeatFrom?: number;
  /** On a repeat marker: how many times the set is run. */
  iterations?: number;
}

export interface ExecutedWorkout {
  name: string | null;
  /** When the workout was created — a coach edit after this is invisible to the watch. */
  createdAt: string | null;
  steps: ExecutedStep[];
}

const num = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** A repeat marker: it structures the workout and is never itself run. */
export function isRepeatMarker(step: ExecutedStep): boolean {
  return step.durationType?.startsWith('REPEAT') === true;
}

/**
 * Narrow the endpoint's payload. Takes either the array it returns or one element of
 * it; null for a run that was not driven by a workout, which is most runs.
 */
export function narrowExecutedWorkout(raw: unknown): ExecutedWorkout | null {
  const wk = (Array.isArray(raw) ? raw[0] : raw) as Record<string, any> | undefined;
  if (!wk || typeof wk !== 'object' || !Array.isArray(wk.steps) || wk.steps.length === 0) return null;

  const steps: ExecutedStep[] = [];
  for (const raw of wk.steps) {
    const s = raw as Record<string, any>;
    const stepIndex = num(s?.stepIndex);
    if (stepIndex == null) continue;
    const durationType = typeof s?.durationType === 'string' ? s.durationType : 'OPEN';
    const value = num(s?.durationValue);
    const repeat = durationType.startsWith('REPEAT');

    // Garmin's target is SPEED in m/s: the LOW speed is the SLOW end of the pace band.
    const speedLow = num(s?.targetValueLow), speedHigh = num(s?.targetValueHigh);
    const isSpeed = s?.targetType === 'SPEED' && !!speedLow && !!speedHigh;

    steps.push({
      stepIndex,
      intensity: typeof s?.intensity === 'string' ? s.intensity : null,
      durationType,
      distanceM: !repeat && durationType === 'DISTANCE' ? value : undefined,
      durationSec: !repeat && durationType === 'TIME' ? value : undefined,
      paceMin: isSpeed ? Math.round(1000 / speedHigh!) : undefined,
      paceMax: isSpeed ? Math.round(1000 / speedLow!) : undefined,
      notes: typeof s?.notes === 'string' && s.notes.trim() ? s.notes.trim() : undefined,
      repeatFrom: repeat ? value : undefined,
      // `targetValue` is the iteration count on a marker. A marker with none is a
      // structure we can't read, and treating it as one iteration keeps the step
      // counts honest rather than inventing a set length.
      iterations: repeat ? (num(s?.targetValue) ?? 1) : undefined,
    });
  }
  if (steps.length === 0) return null;
  return {
    name: typeof wk.workoutName === 'string' ? wk.workoutName.trim() : null,
    createdAt: typeof wk.timeCreated === 'string' ? wk.timeCreated : null,
    steps: steps.sort((a, b) => a.stepIndex - b.stepIndex),
  };
}

/**
 * How many times each step is meant to be run, keyed by stepIndex.
 *
 * A marker at index i going back to f repeats every step in [f, i), so those steps are
 * run `iterations` times. Nested sets multiply, which falls out of applying every
 * marker whose range covers the step.
 */
export function iterationsByStep(workout: ExecutedWorkout): Map<number, number> {
  const out = new Map<number, number>();
  for (const step of workout.steps) {
    if (!isRepeatMarker(step)) out.set(step.stepIndex, 1);
  }
  for (const marker of workout.steps) {
    if (!isRepeatMarker(marker) || marker.repeatFrom == null) continue;
    const times = marker.iterations ?? 1;
    for (const [index, count] of out) {
      if (index >= marker.repeatFrom && index < marker.stepIndex) out.set(index, count * times);
    }
  }
  return out;
}

/**
 * The pace band to grade a step against, in sec/km: the machine target when the
 * workout has one, otherwise the coach's note read at this athlete's lane.
 *
 * Null for a step with no pace asked for at all — a walk-back recovery, an open
 * warm-up — which must stay ungraded rather than be scored against nothing.
 */
export function stepPaceBand(step: ExecutedStep, lane: Lane): { min: number; max: number } | null {
  if (step.paceMin != null && step.paceMax != null) return { min: step.paceMin, max: step.paceMax };
  // A rest step's note is where the coach writes how to recover ("הליכה" — walk), and
  // any pace in it is an instruction, not a target to be judged on.
  if (step.intensity === 'REST' || step.intensity === 'RECOVERY') return null;
  return lanePaceFromNotes(step.notes, lane);
}
