import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep, GroupedWeeklyPlans } from './types';

function formatPaceFromSeconds(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec === 0 ? `${min}:00` : `${min}:${sec.toString().padStart(2, '0')}`;
}

// A single group's pace token: "3:50", "4:15-4:25", or with an en/em dash and
// spaces as the coach writes them: "3:20 – 3:15". DASH matches -, –, or —.
const DASH = '[-–—]';
const PACE_TOKEN = `\\d+:\\d{2}(?:\\s*${DASH}\\s*\\d+:\\d{2})?`;
// ❶ (❷) ((❸)) — three pace tokens in plain / single / double brackets.
const bracketRe = () =>
  new RegExp(`(${PACE_TOKEN})\\s*\\((${PACE_TOKEN})\\)\\s*\\(\\((${PACE_TOKEN})\\)\\)`, 'g');

function rewriteNotesForGroup(notes: string | undefined, group: 1 | 2 | 3): string | undefined {
  if (!notes) return notes;

  // Replace bracket notation with the relevant group's pace
  // Pattern: "3:35(3:45)((3:55))" or "4:15-4:25 (4:25-4:35) ((4:35-4:45))"
  if (!bracketRe().test(notes)) return notes;

  return notes.replace(bracketRe(), (_match, g1, g2, g3) => {
    if (group === 1) return g1;
    if (group === 2) return g2;
    return g3;
  });
}

function parsePaceToSeconds(pace: string): { min: number; max: number } | null {
  const toSec = (m: string, s: string) => parseInt(m) * 60 + parseInt(s);
  const rangeMatch = pace.match(new RegExp(`(\\d+):(\\d+)\\s*${DASH}\\s*(\\d+):(\\d+)`));
  if (rangeMatch) {
    const a = toSec(rangeMatch[1], rangeMatch[2]);
    const b = toSec(rangeMatch[3], rangeMatch[4]);
    // Normalize fast-first: coach writes recovery ranges high-to-low ("4:10-4:00").
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const singleMatch = pace.match(/(\d+):(\d+)/);
  if (singleMatch) {
    const val = toSec(singleMatch[1], singleMatch[2]);
    return { min: val, max: val };
  }
  return null;
}

function extractPacesFromNotes(notes: string | undefined): { g1: { min: number; max: number } | null; g2: { min: number; max: number } | null; g3: { min: number; max: number } | null } {
  if (!notes) return { g1: null, g2: null, g3: null };

  const match = notes.match(new RegExp(bracketRe().source));
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

/**
 * Apply the group offset to a (possibly nested) step, driven by the ORIGINAL
 * step so we can tell which segments already carry an explicit group pace.
 * Recurses into repeat blocks — previously only top-level non-repeat steps got
 * the offset, so Group ❷/❸ came out identical to Group ❶ for every interval
 * workout built as a repeat (the common case).
 */
function applyGroupOffset(
  original: WorkoutStep,
  result: WorkoutStep,
  group: 1 | 2 | 3,
  offsets: { group2Offset: number; group3Offset: number },
  isSubStep = false
): WorkoutStep {
  const offset = group === 2 ? offsets.group2Offset : offsets.group3Offset;

  // Repeat parent: recurse into each sub-step, matching by index against the
  // original so per-sub-step "had explicit pace?" checks stay accurate.
  if (original.repeatSteps && result.repeatSteps) {
    return {
      ...result,
      repeatSteps: result.repeatSteps.map((rs, i) =>
        original.repeatSteps![i]
          ? applyGroupOffset(original.repeatSteps![i], rs, group, offsets, true)
          : rs
      ),
    };
  }

  // Leaf: only offset paced steps that had no explicit group pace / bracket
  // notation (those were already resolved by splitStep). Inside a repeat, only
  // the hard `interval` effort differs per group — the easy `active` float and
  // `rest` segments are shared across groups, so don't shift them.
  const eligible = isSubStep
    ? shouldApplyOffset(original) && original.type === 'interval'
    : shouldApplyOffset(original);
  if (eligible) {
    return applyPaceOffset(result, offset);
  }
  return result;
}

function hasBracketNotation(notes: string | undefined): boolean {
  if (!notes) return false;
  return /\([\d:]+/.test(notes) && /\(\([\d:]+/.test(notes);
}

function shouldApplyOffset(step: WorkoutStep): boolean {
  return (
    step.targetType === 'pace' &&
    !!step.targetPaceMinPerKm &&
    !step.group2Pace &&
    !step.group3Pace &&
    !hasBracketNotation(step.notes) &&
    (step.type === 'interval' || step.type === 'active')
  );
}

function splitWorkout(workout: ParsedWorkout, group: 1 | 2 | 3, offsets: { group2Offset: number; group3Offset: number }): ParsedWorkout {
  return {
    ...workout,
    steps: workout.steps.map(step => {
      const result = splitStep(step, group);
      // Apply the group offset to any paced step that lacked an explicit group
      // pace — including sub-steps inside repeat blocks.
      if (group !== 1) {
        return applyGroupOffset(step, result, group, offsets);
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
