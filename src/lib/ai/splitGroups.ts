import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep, GroupedWeeklyPlans } from './types';

function splitStep(step: WorkoutStep, group: 1 | 2 | 3): WorkoutStep {
  const result = { ...step };

  if (group === 2 && step.group2Pace) {
    result.targetPaceMinPerKm = step.group2Pace.min;
    result.targetPaceMaxPerKm = step.group2Pace.max;
  } else if (group === 3 && step.group3Pace) {
    result.targetPaceMinPerKm = step.group3Pace.min;
    result.targetPaceMaxPerKm = step.group3Pace.max;
  }

  // Remove group pace fields from output
  delete result.group2Pace;
  delete result.group3Pace;

  // Recursively handle repeat steps
  if (result.repeatSteps) {
    result.repeatSteps = result.repeatSteps.map(s => splitStep(s, group));
  }

  return result;
}

function splitWorkout(workout: ParsedWorkout, group: 1 | 2 | 3): ParsedWorkout {
  return {
    ...workout,
    steps: workout.steps.map(step => splitStep(step, group)),
  };
}

export function splitIntoGroups(plan: ParsedWeeklyPlan): GroupedWeeklyPlans {
  return {
    group1: {
      workouts: plan.workouts.map(w => splitWorkout(w, 1)),
    },
    group2: {
      workouts: plan.workouts.map(w => splitWorkout(w, 2)),
    },
    group3: {
      workouts: plan.workouts.map(w => splitWorkout(w, 3)),
    },
  };
}
