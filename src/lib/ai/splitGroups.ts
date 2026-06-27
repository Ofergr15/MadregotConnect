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

function parsePaceToSeconds(pace: string): { min: number; max: number } | null {
  const rangeMatch = pace.match(/(\d+):(\d+)\s*-\s*(\d+):(\d+)/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1]) * 60 + parseInt(rangeMatch[2]);
    const max = parseInt(rangeMatch[3]) * 60 + parseInt(rangeMatch[4]);
    return { min, max };
  }
  const singleMatch = pace.match(/(\d+):(\d+)/);
  if (singleMatch) {
    const val = parseInt(singleMatch[1]) * 60 + parseInt(singleMatch[2]);
    return { min: val, max: val };
  }
  return null;
}

function extractPacesFromNotes(notes: string | undefined): { g1: { min: number; max: number } | null; g2: { min: number; max: number } | null; g3: { min: number; max: number } | null } {
  if (!notes) return { g1: null, g2: null, g3: null };

  const bracketPattern = /([\d:]+-?[\d:]*)\s*\(([\d:]+-?[\d:]*)\)\s*\(\(([\d:]+-?[\d:]*)\)\)/;
  const match = notes.match(bracketPattern);
  if (!match) return { g1: null, g2: null, g3: null };

  return {
    g1: parsePaceToSeconds(match[1]),
    g2: parsePaceToSeconds(match[2]),
    g3: parsePaceToSeconds(match[3]),
  };
}

function splitStep(step: WorkoutStep, group: 1 | 2 | 3): WorkoutStep {
  const result = { ...step };

  if (group === 2 && step.group2Pace) {
    result.targetPaceMinPerKm = step.group2Pace.min;
    result.targetPaceMaxPerKm = step.group2Pace.max;
  } else if (group === 3 && step.group3Pace) {
    result.targetPaceMinPerKm = step.group3Pace.min;
    result.targetPaceMaxPerKm = step.group3Pace.max;
  } else if (group !== 1 && !step.group2Pace && !step.group3Pace) {
    // Fallback: extract paces from bracket notation in notes
    const extracted = extractPacesFromNotes(step.notes);
    if (group === 2 && extracted.g2) {
      result.targetPaceMinPerKm = extracted.g2.min;
      result.targetPaceMaxPerKm = extracted.g2.max;
    } else if (group === 3 && extracted.g3) {
      result.targetPaceMinPerKm = extracted.g3.min;
      result.targetPaceMaxPerKm = extracted.g3.max;
    }
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

function inferPaceOffset(plan: ParsedWeeklyPlan): { group2Offset: number; group3Offset: number } {
  let totalDiff2 = 0;
  let totalDiff3 = 0;
  let count = 0;

  for (const workout of plan.workouts) {
    for (const step of workout.steps) {
      if (step.group2Pace && step.targetPaceMinPerKm) {
        totalDiff2 += step.group2Pace.min - step.targetPaceMinPerKm;
        count++;
      }
      if (step.group3Pace && step.targetPaceMinPerKm) {
        totalDiff3 += step.group3Pace.min - step.targetPaceMinPerKm;
      }
      if (step.notes) {
        const extracted = extractPacesFromNotes(step.notes);
        if (extracted.g1 && extracted.g2) {
          totalDiff2 += extracted.g2.min - extracted.g1.min;
          count++;
        }
        if (extracted.g1 && extracted.g3) {
          totalDiff3 += extracted.g3.min - extracted.g1.min;
        }
      }
      if (step.repeatSteps) {
        for (const rs of step.repeatSteps) {
          if (rs.group2Pace && rs.targetPaceMinPerKm) {
            totalDiff2 += rs.group2Pace.min - rs.targetPaceMinPerKm;
            count++;
          }
          if (rs.group3Pace && rs.targetPaceMinPerKm) {
            totalDiff3 += rs.group3Pace.min - rs.targetPaceMinPerKm;
          }
          if (rs.notes) {
            const ex = extractPacesFromNotes(rs.notes);
            if (ex.g1 && ex.g2) { totalDiff2 += ex.g2.min - ex.g1.min; count++; }
            if (ex.g1 && ex.g3) { totalDiff3 += ex.g3.min - ex.g1.min; }
          }
        }
      }
    }
  }

  if (count === 0) return { group2Offset: 10, group3Offset: 20 };
  return {
    group2Offset: Math.round(totalDiff2 / count),
    group3Offset: Math.round(totalDiff3 / count),
  };
}

function applyPaceOffset(step: WorkoutStep, offset: number): WorkoutStep {
  const result = { ...step };
  if (result.targetPaceMinPerKm) result.targetPaceMinPerKm += offset;
  if (result.targetPaceMaxPerKm) result.targetPaceMaxPerKm += offset;
  if (result.repeatSteps) {
    result.repeatSteps = result.repeatSteps.map(s => applyPaceOffset(s, offset));
  }
  return result;
}

function hasBracketNotation(notes: string | undefined): boolean {
  if (!notes) return false;
  return /\([\d:]+/.test(notes) && /\(\([\d:]+/.test(notes);
}

function splitWorkout(workout: ParsedWorkout, group: 1 | 2 | 3, offsets: { group2Offset: number; group3Offset: number }): ParsedWorkout {
  return {
    ...workout,
    steps: workout.steps.map(step => {
      let result = splitStep(step, group);
      // Apply offset ONLY when:
      // 1. Not group 1
      // 2. Step has a pace target
      // 3. No group2Pace/group3Pace fields existed
      // 4. No bracket notation in notes (notes extraction didn't handle it)
      // 5. Step type is interval/active (not warmup/rest)
      if (
        group !== 1 &&
        step.targetType === 'pace' &&
        step.targetPaceMinPerKm &&
        !step.group2Pace &&
        !step.group3Pace &&
        !hasBracketNotation(step.notes) &&
        (step.type === 'interval' || step.type === 'active')
      ) {
        const offset = group === 2 ? offsets.group2Offset : offsets.group3Offset;
        result = applyPaceOffset(result, offset);
      }
      return result;
    }),
  };
}

export function splitIntoGroups(plan: ParsedWeeklyPlan): GroupedWeeklyPlans {
  const offsets = inferPaceOffset(plan);

  return {
    group1: {
      workouts: plan.workouts.map(w => splitWorkout(w, 1, offsets)),
    },
    group2: {
      workouts: plan.workouts.map(w => splitWorkout(w, 2, offsets)),
    },
    group3: {
      workouts: plan.workouts.map(w => splitWorkout(w, 3, offsets)),
    },
  };
}
