import { ParsedWorkout, WorkoutStep } from '../ai/types';
import { GarminWorkout, GarminWorkoutStep, StoredPaceProfile } from './types';
import { formatPace, getPaceForZone, paceToMetersPerSecond } from './pace';

export interface ConvertOptions {
  // When true, pace steps also get a Garmin pace-zone TARGET (workoutTargetTypeId 6),
  // which makes the watch beep/vibrate when the runner drifts out of range. This is
  // the higher-touch "academy" model. When false/omitted, pace is info-only (the
  // pace shows as on-screen text via the description, with no alert) — the default
  // for regular club athletes.
  paceTarget?: boolean;
}

const STEP_TYPE_MAP: Record<string, { stepTypeId: number; stepTypeKey: string }> = {
  warmup: { stepTypeId: 1, stepTypeKey: 'warmup' },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown' },
  interval: { stepTypeId: 3, stepTypeKey: 'interval' },
  active: { stepTypeId: 3, stepTypeKey: 'interval' },
  rest: { stepTypeId: 4, stepTypeKey: 'rest' },
  recovery: { stepTypeId: 4, stepTypeKey: 'recovery' },
};

const END_CONDITION_MAP: Record<string, { conditionTypeId: number; conditionTypeKey: string }> = {
  time: { conditionTypeId: 2, conditionTypeKey: 'time' },
  distance: { conditionTypeId: 3, conditionTypeKey: 'distance' },
  open: { conditionTypeId: 1, conditionTypeKey: 'lap.button' },
};

/**
 * ONE RUNNING COUNTER FOR A WHOLE WORKOUT — see feedback ccc4e092.
 *
 * Both numbers have to be unique across the FLATTENED step list, including the
 * steps nested inside a repeat group, because that is the list Garmin Connect's
 * editor builds when it opens the workout. It used to restart at 1 inside every
 * repeat (`convertStep(s, …, i + 1)`), so a 6×400 workout shipped several steps
 * all claiming stepOrder 1 and none of them carrying a stepId at all. The watch
 * ran it fine — it reads the tree — but the editor keys its rows by those two
 * fields and PUT the mess straight back, which is the save that never worked.
 */
interface StepNumbering {
  order: number;
  id: number;
}

function convertStep(
  step: WorkoutStep,
  paceProfile: StoredPaceProfile,
  num: StepNumbering,
  opts: ConvertOptions = {},
  /** The enclosing repeat group's `stepId`, when this step is one of its children. */
  childStepId: number | null = null
): GarminWorkoutStep {
  const stepOrder = ++num.order;
  const stepId = ++num.id;

  if (step.repeatCount && step.repeatSteps) {
    return {
      type: 'RepeatGroupDTO',
      stepId,
      stepOrder,
      childStepId,
      stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
      endCondition: { conditionTypeId: 7, conditionTypeKey: 'iterations' },
      numberOfIterations: step.repeatCount,
      // Garmin's editor reads the iteration count off endConditionValue, not off
      // numberOfIterations, and shows an empty "repeat ? times" box without it —
      // which is a required field, so the save is refused.
      endConditionValue: step.repeatCount,
      smartRepeat: false,
      targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
      workoutSteps: step.repeatSteps.map((s) =>
        convertStep(s, paceProfile, num, opts, stepId)
      ),
    };
  }

  const garminStep: GarminWorkoutStep = {
    type: 'ExecutableStepDTO',
    stepId,
    stepOrder,
    childStepId,
    stepType: STEP_TYPE_MAP[step.type] || STEP_TYPE_MAP.active,
    endCondition: END_CONDITION_MAP[step.durationType] || END_CONDITION_MAP.open,
    targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
  };

  if (step.durationType === 'distance' && step.durationValue) {
    garminStep.endConditionValue = step.durationValue;
  } else if (step.durationType === 'time' && step.durationValue) {
    garminStep.endConditionValue = step.durationValue;
  }

  // The step description is what the watch DISPLAYS on-screen at each step (and
  // is read out by Garmin Audio Prompts on supported setups). Keep it concise —
  // pace + special cues like ג׳ל / שתייה. This is also the anchor for a future
  // "voice reminder to take a gel / drink water" feature: those cues already
  // live in the notes, so a step-transition audio cue can be built on top.
  //
  // By default we do NOT set a Garmin pace-zone target: a pace zone makes the watch
  // beep/vibrate whenever the runner drifts out of range, and Garmin has no "target
  // pace without alert". Instead we surface the target pace as info only, via this
  // description text (the step keeps the default 'no.target' set above).
  const description = buildStepDescription(step, paceProfile);
  if (description) {
    garminStep.description = description;
  }

  // Academy model (opts.paceTarget): additionally attach a real pace-zone target so
  // the watch actively alerts when off-pace. targetValueOne = faster pace (higher
  // m/s), targetValueTwo = slower pace. We keep the description too, so the pace is
  // both enforced and shown.
  if (opts.paceTarget && step.targetType === 'pace') {
    if (step.targetPaceMinPerKm) {
      const hasRange = !!step.targetPaceMaxPerKm && step.targetPaceMaxPerKm !== step.targetPaceMinPerKm;
      garminStep.targetType = { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' };
      garminStep.targetValueOne = paceToMetersPerSecond(step.targetPaceMinPerKm);
      if (hasRange) {
        garminStep.targetValueTwo = paceToMetersPerSecond(step.targetPaceMaxPerKm!);
      }
    } else if (step.targetZone) {
      const paceRange = getPaceForZone(step.targetZone, paceProfile);
      // No paces for this zone → leave the step on the no.target it was built
      // with. A pace zone here would have to be invented, and this branch's
      // whole purpose is to make the watch beep when the runner leaves the
      // range: an invented range means beeping at a runner for missing a pace
      // nobody set. Silence is the correct answer.
      if (paceRange) {
        garminStep.targetType = { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' };
        garminStep.targetValueOne = paceToMetersPerSecond(paceRange.min);
        garminStep.targetValueTwo = paceToMetersPerSecond(paceRange.max);
      }
    }
  }

  return garminStep;
}

// A human-readable pace label from the numeric fields / zone, e.g. "3:20" or
// "3:15-3:20". Used only as a fallback when the notes don't already carry a pace.
function buildPaceLabel(
  step: WorkoutStep,
  paceProfile: StoredPaceProfile
): string | undefined {
  if (step.targetType !== 'pace') return undefined;

  if (step.targetPaceMinPerKm) {
    const min = step.targetPaceMinPerKm;
    const max = step.targetPaceMaxPerKm;
    return max && max !== min ? `${formatPace(min)}-${formatPace(max)}` : formatPace(min);
  }

  if (step.targetZone) {
    const range = getPaceForZone(step.targetZone, paceProfile);
    // Undefined, not a placeholder: the label is what the watch prints on screen
    // mid-run, and a zone name with no paces behind it has nothing to print.
    if (range) return `${formatPace(range.min)}-${formatPace(range.max)}`;
  }

  return undefined;
}

// Guarantee the on-screen description carries the target pace. Notes are the
// source of truth (they hold the coach's "3:20 (3:30) ((3:40))" bracket notation),
// so we keep them verbatim when they already contain a pace token. Otherwise we
// synthesize the pace from the numeric fields/zone so pace still shows even on
// regex-fallback or zone-only steps whose notes were stripped of the pace.
function buildStepDescription(
  step: WorkoutStep,
  paceProfile: StoredPaceProfile
): string | undefined {
  const notes = step.notes?.trim();
  const label = buildPaceLabel(step, paceProfile);
  const notesHavePace = !!notes && /\d+:\d{2}/.test(notes);

  if (notes && notesHavePace) return notes; // normal Claude path — keep verbatim
  if (notes && label) return `${label} ${notes}`; // e.g. "3:20 ג׳ל"
  return notes || label || undefined; // whichever exists
}

export function convertToGarminWorkout(
  workout: ParsedWorkout,
  paceProfile: StoredPaceProfile,
  opts: ConvertOptions = {}
): GarminWorkout {
  // One counter for the whole workout, handed down through the repeat groups, so
  // stepOrder/stepId are unique across every step Garmin will render.
  const num: StepNumbering = { order: 0, id: 0 };
  const workoutSteps: GarminWorkoutStep[] = workout.steps.map((step) =>
    convertStep(step, paceProfile, num, opts)
  );

  return {
    workoutName: workout.name,
    // Sets the workout Notes on Garmin. Without this the garmin-connect library
    // stamps its default "Added by garmin-connect for Node.js".
    description: 'Added by Madregot app',
    sportType: { sportTypeId: 1, sportTypeKey: 'running' },
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeId: 1, sportTypeKey: 'running' },
        workoutSteps,
      },
    ],
  };
}
