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

function splitWorkout(workout: ParsedWorkout, group: 1 | 2 | 3): ParsedWorkout {
  return {
    ...workout,
    // Groups differ ONLY where the coach wrote an explicit per-group pace —
    // group2Pace/group3Pace or bracket notation "X (Y) ((Z))", both resolved by
    // splitStep. When the coach gave a single pace, all groups run it as-is (no
    // inferred offset), so the pace always matches the notes.
    steps: workout.steps.map(step => splitStep(step, group)),
  };
}

export function splitIntoGroups(plan: ParsedWeeklyPlan): GroupedWeeklyPlans {
  return {
    group1: { workouts: plan.workouts.map(w => splitWorkout(w, 1)) },
    group2: { workouts: plan.workouts.map(w => splitWorkout(w, 2)) },
    group3: { workouts: plan.workouts.map(w => splitWorkout(w, 3)) },
  };
}
