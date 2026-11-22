import { DIST_UNIT_RE, TIME_UNIT_RE, paceFromNotes } from '@/lib/ai/parser';
import type { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

/**
 * Per-step confidence + provenance for the review screen (BUILD-BRIEF item 2).
 *
 * Computed AFTER the existing parser, never inside it: the parser and its prompt are the
 * accuracy-critical path and are not forked. Flags are read off what the parser already
 * did (validateAndFixStep's unit guards, paceFromNotes' override) so the coach sees which
 * numbers the app inferred rather than read.
 */
export type StepFlag = 'unit_ambiguous' | 'pace_from_notes' | 'unread';

export interface SourceCell {
  page: number;
  /** Row of the plan table, in day order as read. */
  row: number;
  col: number | null;
  /** True while the cell is inferred from day order rather than returned by the model. */
  approximate: boolean;
}

export interface AnnotatedStep extends WorkoutStep {
  flags: StepFlag[];
  source: SourceCell;
  repeatSteps?: AnnotatedStep[];
}
export interface AnnotatedWorkout extends Omit<ParsedWorkout, 'steps'> { steps: AnnotatedStep[] }
export interface AnnotatedPlan {
  workouts: AnnotatedWorkout[];
  /** Days 0–6 the parse returned nothing for. Non-empty ⇒ the "partial parse" state. */
  missingDays: number[];
  flagCount: number;
}

export function stepFlags(step: WorkoutStep): StepFlag[] {
  const flags: StepFlag[] = [];
  const notes = step.notes || '';
  if (step.durationType !== 'open' && notes) {
    const t = TIME_UNIT_RE.test(notes);
    const d = DIST_UNIT_RE.test(notes);
    if (t && d) flags.push('unit_ambiguous');
  }
  if (step.targetType === 'pace' && paceFromNotes(notes)) flags.push('pace_from_notes');
  if ((step.durationType === 'open' && !notes.trim() && !step.repeatSteps?.length) ||
      (step.durationType !== 'open' && !step.durationValue && !step.repeatSteps?.length)) {
    flags.push('unread');
  }
  return flags;
}

function annotateStep(step: WorkoutStep, cell: SourceCell): AnnotatedStep {
  const given = (step as { source?: Partial<SourceCell> }).source;
  const source: SourceCell = given && typeof given.row === 'number'
    ? { page: given.page ?? 1, row: given.row, col: given.col ?? null, approximate: false }
    : cell;
  return {
    ...step,
    flags: stepFlags(step),
    source,
    repeatSteps: step.repeatSteps?.map((s) => annotateStep(s, source)),
  };
}

export function annotatePlan(plan: ParsedWeeklyPlan): AnnotatedPlan {
  const order = [...new Set(plan.workouts.map((w) => w.dayOfWeek))].sort((a, b) => a - b);
  const workouts = plan.workouts.map((w) => {
    const cell: SourceCell = { page: 1, row: order.indexOf(w.dayOfWeek), col: null, approximate: true };
    return { ...w, steps: w.steps.map((s) => annotateStep(s, cell)) };
  });
  const present = new Set(plan.workouts.map((w) => w.dayOfWeek));
  const missingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !present.has(d));
  const count = (steps: AnnotatedStep[]): number =>
    steps.reduce((n, s) => n + (s.flags.length ? 1 : 0) + count(s.repeatSteps || []), 0);
  return { workouts, missingDays, flagCount: workouts.reduce((n, w) => n + count(w.steps), 0) };
}

/** Strip the review-only fields before a body is stored or pushed. */
export function stripAnnotations(plan: { workouts: AnnotatedWorkout[] | ParsedWorkout[] }): ParsedWeeklyPlan {
  const clean = (s: WorkoutStep & { flags?: unknown; source?: unknown }): WorkoutStep => {
    const { flags: _f, source: _s, ...rest } = s;
    return { ...rest, repeatSteps: rest.repeatSteps?.map(clean) } as WorkoutStep;
  };
  return { workouts: plan.workouts.map((w) => ({ ...w, steps: w.steps.map(clean) })) as ParsedWorkout[] };
}
