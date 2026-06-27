import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep, GroupedWeeklyPlans } from './types';

function formatPaceFromSeconds(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec === 0 ? `${min}:00` : `${min}:${sec.toString().padStart(2, '0')}`;
}

function rewriteNotesForGroup(notes: string | undefined, group: 1 | 2 | 3): string | undefined {
  if (!notes) return notes;

  // Replace bracket notation with the relevant group's pace
  // Pattern: "3:35(3:45)((3:55))" or "4:15-4:25 (4:25-4:35) ((4:35-4:45))"
  const bracketPattern = /([\d:]+(?:-[\d:]+)?)\s*\(([\d:]+(?:-[\d:]+)?)\)\s*\(\(([\d:]+(?:-[\d:]+)?)\)\)/g;

  if (!bracketPattern.test(notes)) return notes;

  return notes.replace(
    /([\d:]+(?:-[\d:]+)?)\s*\(([\d:]+(?:-[\d:]+)?)\)\s*\(\(([\d:]+(?:-[\d:]+)?)\)\)/g,
    (_match, g1, g2, g3) => {
      if (group === 1) return g1;
      if (group === 2) return g2;
      return g3;
    }
  );
}

function splitStep(step: WorkoutStep, group: 1 | 2 | 3): WorkoutStep {
  const result = { ...step };

  if (group === 2 && step.group2Pace) {
    result.targetPaceMinPerKm = step.group2Pace.min;
    result.targetPaceMaxPerKm = step.group2Pace.max;
  } else if (group === 3 && step.group3Pace) {
    result.targetPaceMinPerKm = step.group3Pace.min;
    result.targetPaceMaxPerKm = step.group3Pace.max;
  }

  result.notes = rewriteNotesForGroup(result.notes, group);

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
