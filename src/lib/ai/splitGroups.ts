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

  if (group === 2 && step.group2HeartRate) {
    result.targetHrMinPct = step.group2HeartRate.min;
    result.targetHrMaxPct = step.group2HeartRate.max;
    result.targetType = 'heart_rate';
  } else if (group === 3 && step.group3HeartRate) {
    result.targetHrMinPct = step.group3HeartRate.min;
    result.targetHrMaxPct = step.group3HeartRate.max;
    result.targetType = 'heart_rate';
  }

  result.notes = rewriteNotesForGroup(result.notes, group);

  // Remove group pace fields from output
  delete result.group2Pace;
  delete result.group3Pace;
  delete result.group2HeartRate;
  delete result.group3HeartRate;

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

/**
 * One lane's pace band out of a free-text note, in sec/km — the coach's own
 * notation, read wherever it turns up.
 *
 * It turns up in more than the plan text. The structured workouts on the athletes'
 * watches carry the coach's notes verbatim on each step ("4:25 (4:35) ((4:45))",
 * "5:00-5:30"), and Garmin stores no machine-readable pace target for them at all —
 * one workout in eight has a SPEED target, the rest have the note. So the note IS
 * the target for grading a watch-driven run, which means this reading of it cannot be
 * private to the plan splitter.
 *
 * A note with no bracket notation is one pace for everybody, so every lane gets it —
 * that is the same rule `splitStep` applies, and most club weeks are written that way.
 * Null when there is no pace in the text at all.
 */
export function lanePaceFromNotes(
  notes: string | null | undefined,
  lane: 1 | 2 | 3,
): { min: number; max: number } | null {
  if (!notes) return null;
  const byLane = extractPacesFromNotes(notes);
  const picked = lane === 1 ? byLane.g1 : lane === 2 ? byLane.g2 : byLane.g3;
  if (picked) return picked;
  return parsePaceToSeconds(notes);
}

export function splitIntoGroups(plan: ParsedWeeklyPlan): GroupedWeeklyPlans {
  return {
    group1: { workouts: plan.workouts.map(w => splitWorkout(w, 1)) },
    group2: { workouts: plan.workouts.map(w => splitWorkout(w, 2)) },
    group3: { workouts: plan.workouts.map(w => splitWorkout(w, 3)) },
  };
}

// ── mergeGroupsToUnified — the inverse of splitIntoGroups ──────────────────────
// Editing three separately-tabbed group plans made it easy to lose track of
// which groups actually differ; the unified editor instead shows ONE plan
// where a step's own pace is Group ❶ and group2Pace/group3Pace only exist
// when a group's resolved pace actually differs. Assumes all three groups
// share the same day/step/repeat structure — true for anything ever produced
// by splitIntoGroups, since it maps the same steps array three times.

function paceMatches(a?: number, b?: number): boolean {
  return (a ?? null) === (b ?? null);
}

// Re-composes bracket notation into notes ONLY when the base (group1) notes
// is itself a bare pace token (e.g. "3:50", "4:15-4:20") — the shape the AI
// parser actually produces for pace-differentiated steps. Notes carrying
// other text (e.g. "הליכה") are left untouched; the structured group2Pace/
// group3Pace fields alone stay the source of truth for those.
function mergeNotesForStep(g1Notes: string | undefined, g2Notes: string | undefined, g3Notes: string | undefined, differs: boolean): string | undefined {
  if (!differs) return g1Notes;
  const bareToken = new RegExp(`^\\s*${PACE_TOKEN}\\s*$`);
  if (g1Notes && bareToken.test(g1Notes)) {
    return `${g1Notes} (${g2Notes ?? g1Notes}) ((${g3Notes ?? g1Notes}))`;
  }
  return g1Notes;
}

function mergeStep(s1: WorkoutStep, s2: WorkoutStep, s3: WorkoutStep): WorkoutStep {
  const result: WorkoutStep = { ...s1 };

  const paceDiffers =
    !paceMatches(s1.targetPaceMinPerKm, s2.targetPaceMinPerKm) || !paceMatches(s1.targetPaceMaxPerKm, s2.targetPaceMaxPerKm) ||
    !paceMatches(s1.targetPaceMinPerKm, s3.targetPaceMinPerKm) || !paceMatches(s1.targetPaceMaxPerKm, s3.targetPaceMaxPerKm);

  if (paceDiffers) {
    if (s2.targetPaceMinPerKm != null) result.group2Pace = { min: s2.targetPaceMinPerKm, max: s2.targetPaceMaxPerKm ?? s2.targetPaceMinPerKm };
    if (s3.targetPaceMinPerKm != null) result.group3Pace = { min: s3.targetPaceMinPerKm, max: s3.targetPaceMaxPerKm ?? s3.targetPaceMinPerKm };
  } else {
    delete result.group2Pace;
    delete result.group3Pace;
  }

  const hrDiffers =
    !paceMatches(s1.targetHrMinPct, s2.targetHrMinPct) || !paceMatches(s1.targetHrMaxPct, s2.targetHrMaxPct) ||
    !paceMatches(s1.targetHrMinPct, s3.targetHrMinPct) || !paceMatches(s1.targetHrMaxPct, s3.targetHrMaxPct);
  if (hrDiffers) {
    if (s2.targetHrMinPct != null) result.group2HeartRate = { min: s2.targetHrMinPct, max: s2.targetHrMaxPct ?? s2.targetHrMinPct };
    if (s3.targetHrMinPct != null) result.group3HeartRate = { min: s3.targetHrMinPct, max: s3.targetHrMaxPct ?? s3.targetHrMinPct };
  } else {
    delete result.group2HeartRate;
    delete result.group3HeartRate;
  }

  result.notes = mergeNotesForStep(s1.notes, s2.notes, s3.notes, paceDiffers);

  if (s1.repeatSteps && s2.repeatSteps && s3.repeatSteps) {
    result.repeatSteps = s1.repeatSteps.map((sub, i) => mergeStep(sub, s2.repeatSteps![i] ?? sub, s3.repeatSteps![i] ?? sub));
  }

  return result;
}

function mergeWorkout(w1: ParsedWorkout, w2: ParsedWorkout, w3: ParsedWorkout): ParsedWorkout {
  return {
    ...w1,
    steps: w1.steps.map((step, i) => mergeStep(step, w2.steps[i] ?? step, w3.steps[i] ?? step)),
  };
}

export function mergeGroupsToUnified(grouped: GroupedWeeklyPlans): ParsedWeeklyPlan {
  return {
    workouts: grouped.group1.workouts.map((w, i) =>
      mergeWorkout(w, grouped.group2.workouts[i] ?? w, grouped.group3.workouts[i] ?? w)),
  };
}

// ── applyUnifiedEditsToGroups ────────────────────────────────────────────────
// Writes unified-editor edits back into three EXISTING group plans, matching
// workouts by array position (stable — mergeGroupsToUnified builds the
// unified list in group1's order and edits never reorder it). Deliberately
// NOT a plain splitIntoGroups(unified): a published plan's group2/group3
// workout objects carry their own clipboardImageUrl/clipboardText (real,
// already-distinct per-group artifacts from Clipboard Studio) that a fresh
// split would silently collapse to group1's copy, since the unified
// representation only ever carries ONE workout-level object per day. Only
// `steps` (and coach-editable name/description) get overwritten; every other
// per-group field is preserved untouched. New workouts added via the unified
// editor (no existing per-group counterpart yet) get a fresh 3-way split
// instead, since there's nothing to preserve.
export function applyUnifiedEditsToGroups(existing: GroupedWeeklyPlans, unified: ParsedWeeklyPlan): GroupedWeeklyPlans {
  const applyGroup = (group: 1 | 2 | 3): ParsedWeeklyPlan => {
    const existingWorkouts = existing[`group${group}` as keyof GroupedWeeklyPlans].workouts;
    return {
      workouts: unified.workouts.map((uw, i) => {
        const base = existingWorkouts[i];
        const splitSteps = splitWorkout(uw, group).steps;
        if (!base) {
          // Newly added workout — no prior per-group object to preserve.
          return { ...uw, steps: splitSteps };
        }
        return { ...base, name: uw.name, description: uw.description, steps: splitSteps };
      }),
    };
  };
  return { group1: applyGroup(1), group2: applyGroup(2), group3: applyGroup(3) };
}
