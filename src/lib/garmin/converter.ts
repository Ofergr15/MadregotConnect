import { ParsedWorkout, WorkoutStep } from '../ai/types';
import { GarminWorkout, GarminWorkoutStep, PaceProfile } from './types';
import { paceToMetersPerSecond, getPaceForZone } from './pace';

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
  stepOrder: number
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
        convertStep(s, paceProfile, i + 1)
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
  if (step.notes) {
    garminStep.description = step.notes;
  }

  if (step.targetType === 'pace') {
    garminStep.targetType = {
      workoutTargetTypeId: 6,
      workoutTargetTypeKey: 'pace.zone',
    };

    if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
      // Garmin: targetValueOne = faster pace (higher m/s), targetValueTwo = slower pace (lower m/s)
      garminStep.targetValueOne = paceToMetersPerSecond(step.targetPaceMinPerKm);
      garminStep.targetValueTwo = paceToMetersPerSecond(step.targetPaceMaxPerKm);
    } else if (step.targetZone) {
      const paceRange = getPaceForZone(step.targetZone, paceProfile);
      // min seconds/km = faster pace = higher m/s = targetValueOne
      garminStep.targetValueOne = paceToMetersPerSecond(paceRange.min);
      garminStep.targetValueTwo = paceToMetersPerSecond(paceRange.max);
    }
  }

  return garminStep;
}

export function convertToGarminWorkout(
  workout: ParsedWorkout,
  paceProfile: PaceProfile
): GarminWorkout {
  let stepOrder = 0;
  const workoutSteps: GarminWorkoutStep[] = workout.steps.map((step) => {
    stepOrder++;
    return convertStep(step, paceProfile, stepOrder);
  });

  return {
    workoutName: workout.name,
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
