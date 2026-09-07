import type { AutoFix, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { minutesRangeFromNotes } from '@/lib/plans/step-estimate';

/**
 * The one thing this screen repairs by itself: a time range the parse collapsed
 * to a single figure, put back from the coach's own note.
 *
 * ── WHY IT IS FIXED AND NOT JUST REPORTED ───────────────────────────────────
 * Saturday is written "40-50 דק׳" and arrives as `durationValue: 2400`. Every
 * screen the COACH looks at already reads the range back out of the note
 * (`stepMetric`, `stepTimeRange`), so the app's own numbers were right and the
 * defect was invisible where it mattered: the athlete's board is built from
 * `durationValue`, so sixty phones got "40 min" for a 40–50 minute run. A
 * warning the coach has to act on nine times a week is a warning that gets
 * clicked past; the note IS the coach's instruction, so the range is not a guess
 * that needs approving.
 *
 * ── WHAT MAKES IT SAFE ──────────────────────────────────────────────────────
 * The fix only fires on the exact fingerprint of a collapse: the step is a TIME
 * step, its own note states a RANGE, and the stored value sits INSIDE that range.
 * That bracket test is what keeps it off notes whose minutes describe something
 * else — "6 × 90 שניות" inside a 40-minute block does not redefine the block, and
 * neither does a note about the week's other days.
 *
 * ── UNDO ────────────────────────────────────────────────────────────────────
 * Every fix is recorded on the workout with the value it replaced, so undo is
 * exact rather than a re-derivation. `autoFixes: []` is meaningful and different
 * from absent: it means the coach looked at the fix and took it back, and it is
 * what stops normalization — which runs on READ as well as write — from quietly
 * re-applying it on the next page load.
 */

export interface TimeRange {
  min: number;
  max: number;
}

/**
 * The range this step was collapsed from, or null if it wasn't.
 *
 * A step already carrying `durationMaxValue` is not a candidate: it has both ends
 * of its range, whoever put them there.
 */
export function collapsedTimeRange(step: WorkoutStep): TimeRange | null {
  if (step.durationType !== 'time' || !step.durationValue) return null;
  if (step.durationMaxValue) return null;
  const stated = minutesRangeFromNotes(step.notes);
  if (!stated || stated.min === stated.max) return null;
  if (step.durationValue < stated.min || step.durationValue > stated.max) return null;
  return stated;
}

/** Walk every step, containers included, with the path that identifies it. */
function walk(
  steps: WorkoutStep[],
  path: number[],
  visit: (step: WorkoutStep, path: number[]) => void,
) {
  steps.forEach((step, index) => {
    const here = [...path, index];
    visit(step, here);
    if (step.repeatSteps?.length) walk(step.repeatSteps, here, visit);
  });
}

/** The step at a recorded path, or undefined if the plan has been restructured. */
function stepAt(workout: ParsedWorkout, path: number[]): WorkoutStep | undefined {
  let steps: WorkoutStep[] | undefined = workout.steps;
  let step: WorkoutStep | undefined;
  for (const index of path) {
    step = steps?.[index];
    if (!step) return undefined;
    steps = step.repeatSteps;
  }
  return step;
}

/** Copy a step tree so a fix never mutates the caller's plan. */
function cloneSteps(steps: WorkoutStep[]): WorkoutStep[] {
  return steps.map((step) => ({
    ...step,
    ...(step.repeatSteps?.length ? { repeatSteps: cloneSteps(step.repeatSteps) } : {}),
  }));
}

/**
 * Restore every collapsed time range in one session.
 *
 * Idempotent, and a no-op once `autoFixes` exists — including when it is empty,
 * which is the coach's undo. Returns the input object itself when nothing
 * changed, so callers can compare by identity.
 */
export function autoFixWorkout(workout: ParsedWorkout): ParsedWorkout {
  if (workout.autoFixes) return workout;

  const fixes: AutoFix[] = [];
  walk(workout.steps || [], [], (step, path) => {
    const stated = collapsedTimeRange(step);
    if (!stated) return;
    fixes.push({
      code: 'timeRange',
      stepPath: path,
      fromSec: step.durationValue as number,
      toSec: { ...stated },
    });
  });

  if (!fixes.length) return workout;

  const fixed: ParsedWorkout = { ...workout, steps: cloneSteps(workout.steps || []), autoFixes: fixes };
  for (const fix of fixes) {
    const step = stepAt(fixed, fix.stepPath);
    if (!step) continue;
    step.durationValue = fix.toSec.min;
    step.durationMaxValue = fix.toSec.max;
  }
  return fixed;
}

/**
 * Put the session back the way it was parsed, and remember that the coach asked.
 *
 * `autoFixes: []` is left behind on purpose — see the note on re-application at
 * the top of this file.
 */
export function undoAutoFixes(workout: ParsedWorkout): ParsedWorkout {
  if (!workout.autoFixes?.length) return { ...workout, autoFixes: [] };

  const restored: ParsedWorkout = { ...workout, steps: cloneSteps(workout.steps || []), autoFixes: [] };
  for (const fix of workout.autoFixes) {
    const step = stepAt(restored, fix.stepPath);
    if (!step) continue;
    step.durationValue = fix.fromSec;
    delete step.durationMaxValue;
  }
  return restored;
}

/** The steps this session's fixes changed — what the finding points the coach at. */
export function autoFixedSteps(workout: ParsedWorkout): WorkoutStep[] {
  return (workout.autoFixes || [])
    .map((fix) => stepAt(workout, fix.stepPath))
    .filter((step): step is WorkoutStep => Boolean(step));
}
