import { ParsedWorkout, WorkoutStep } from '../ai/types';
import { GarminWorkout, GarminWorkoutStep, PaceProfile } from './types';
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

function convertStep(
  step: WorkoutStep,
  paceProfile: PaceProfile,
  stepOrder: number,
  opts: ConvertOptions = {}
): GarminWorkoutStep {
  if (step.repeatCount && step.repeatSteps) {
    return {
      type: 'RepeatGroupDTO',
      stepOrder,
      stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
      endCondition: { conditionTypeId: 7, conditionTypeKey: 'iterations' },
      numberOfIterations: step.repeatCount,
      targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
      workoutSteps: step.repeatSteps.map((s, i) =>
        convertStep(s, paceProfile, i + 1, opts)
      ),
    };
  }

  const garminStep: GarminWorkoutStep = {
    type: 'ExecutableStepDTO',
    stepOrder,
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
      garminStep.targetType = { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' };
      garminStep.targetValueOne = paceToMetersPerSecond(paceRange.min);
      garminStep.targetValueTwo = paceToMetersPerSecond(paceRange.max);
    }
  }

  return garminStep;
}

// A human-readable pace label from the numeric fields / zone, e.g. "3:20" or
// "3:15-3:20". Used only as a fallback when the notes don't already carry a pace.
function buildPaceLabel(
  step: WorkoutStep,
  paceProfile: PaceProfile
): string | undefined {
  if (step.targetType !== 'pace') return undefined;

  if (step.targetPaceMinPerKm) {
    const min = step.targetPaceMinPerKm;
    const max = step.targetPaceMaxPerKm;
    return max && max !== min ? `${formatPace(min)}-${formatPace(max)}` : formatPace(min);
  }

  if (step.targetZone) {
    const range = getPaceForZone(step.targetZone, paceProfile);
    return `${formatPace(range.min)}-${formatPace(range.max)}`;
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
  paceProfile: PaceProfile
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
  paceProfile: PaceProfile,
  opts: ConvertOptions = {}
): GarminWorkout {
  let stepOrder = 0;
  const workoutSteps: GarminWorkoutStep[] = workout.steps.map((step) => {
    stepOrder++;
    return convertStep(step, paceProfile, stepOrder, opts);
  });

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
