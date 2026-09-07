import { describe, expect, it } from 'vitest';
import { autoFixWorkout, autoFixedSteps, collapsedTimeRange, undoAutoFixes } from '@/lib/plans/auto-fix';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { parsedWorkoutToClipboard } from '@/lib/plans/clipboard';
import { stepMetric, LATIN_UNITS } from '@/lib/plans/step-display';
import { stepTimeRange } from '@/lib/plans/step-estimate';
import { auditWorkout } from '@/lib/plans/workout-audit';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The case: Wednesday is written "70-90 דק׳ ריצת שחרור קלה" in the program and
// arrives from the parse as `durationValue: 4200` — one end of the coach's range.
// The coach-facing screens always read the range back out of the note, so the
// only place the collapse was visible was the athlete's board.

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'time',
    durationValue: 600,
    targetType: 'pace',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[], over: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return { dayOfWeek: 3, name: 'יום רביעי', steps, ...over } as ParsedWorkout;
}

const COLLAPSED = () => workout([
  step({ durationValue: 4200, targetType: 'no_target', notes: '70-90 דק׳ ריצת שחרור קלה' }),
]);

describe('collapsedTimeRange', () => {
  it('recognises the 70 that was written 70-90', () => {
    expect(collapsedTimeRange(COLLAPSED().steps[0])).toEqual({ min: 4200, max: 5400 });
  });

  it('leaves a time whose note states that one time', () => {
    expect(collapsedTimeRange(step({ durationValue: 3600, notes: '60 דק׳ 4:50-5:30' }))).toBeNull();
  });

  it('does not read the reps inside a block as the block\'s own range', () => {
    // "6 × 90 שניות" in a 40-minute block does not redefine the block.
    expect(collapsedTimeRange(step({ durationValue: 2400, notes: '6 × 90 שניות' }))).toBeNull();
  });

  it('leaves a value that sits OUTSIDE the note\'s range alone', () => {
    // 100 minutes stored against a "70-90" note is not a collapse, it is a
    // disagreement, and guessing which one is right is not this function's job.
    expect(collapsedTimeRange(step({ durationValue: 6000, notes: '70-90 דק׳' }))).toBeNull();
  });

  it('leaves a step that already carries both ends alone', () => {
    expect(collapsedTimeRange(step({ durationValue: 4200, durationMaxValue: 5400, notes: '70-90 דק׳' })))
      .toBeNull();
  });
});

describe('autoFixWorkout', () => {
  it('restores the range and records what it replaced', () => {
    const fixed = autoFixWorkout(COLLAPSED());
    expect(fixed.steps[0]).toMatchObject({ durationValue: 4200, durationMaxValue: 5400 });
    expect(fixed.autoFixes).toEqual([
      { code: 'timeRange', stepPath: [0], fromSec: 4200, toSec: { min: 4200, max: 5400 } },
    ]);
  });

  it('reaches inside a repeat block', () => {
    const fixed = autoFixWorkout(workout([
      step({ order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000 }),
      step({
        order: 2,
        repeatCount: 3,
        repeatSteps: [step({ order: 1, durationValue: 2400, notes: '40-50 דק׳' })],
      }),
    ]));
    expect(fixed.autoFixes?.[0].stepPath).toEqual([1, 0]);
    expect(fixed.steps[1].repeatSteps?.[0].durationMaxValue).toBe(3000);
  });

  it('does not touch the plan it was given', () => {
    const original = COLLAPSED();
    autoFixWorkout(original);
    expect(original.steps[0].durationMaxValue).toBeUndefined();
    expect(original.autoFixes).toBeUndefined();
  });

  it('is idempotent, and returns the same object when there is nothing to fix', () => {
    const clean = workout([step({ durationValue: 3600, notes: '60 דק׳' })]);
    expect(autoFixWorkout(clean)).toBe(clean);
    const fixed = autoFixWorkout(COLLAPSED());
    expect(autoFixWorkout(fixed)).toBe(fixed);
  });

  it('never re-applies a fix the coach undid', () => {
    // The empty list is the record of the undo — without it, normalization would
    // put the fix back on the next read.
    const undone = undoAutoFixes(autoFixWorkout(COLLAPSED()));
    const again = autoFixWorkout(undone);
    expect(again.steps[0].durationMaxValue).toBeUndefined();
    expect(again.steps[0].durationValue).toBe(4200);
  });
});

describe('undoAutoFixes', () => {
  it('puts the parsed value back exactly', () => {
    const undone = undoAutoFixes(autoFixWorkout(COLLAPSED()));
    expect(undone.steps[0].durationValue).toBe(4200);
    expect(undone.steps[0].durationMaxValue).toBeUndefined();
    expect(undone.autoFixes).toEqual([]);
  });

  it('marks a session that had nothing to undo as considered', () => {
    expect(undoAutoFixes(workout([step()])).autoFixes).toEqual([]);
  });
});

describe('what the fix changes downstream', () => {
  it('puts the range on the athlete\'s board', () => {
    // What sixty phones used to get for a 70–90 minute run: a stopwatch reading
    // of one end of it.
    const before = parsedWorkoutToClipboard(COLLAPSED());
    expect(before.segments[0].detail).toContain('1:10:00');

    const after = parsedWorkoutToClipboard(autoFixWorkout(COLLAPSED()));
    expect(after.segments[0].detail).toContain('70-90 min');
  });

  it('reports the same minutes to the coach as before', () => {
    // The coach's screens were already right (they read the note), so the fix
    // must not move their numbers — only the board's.
    const fixed = autoFixWorkout(COLLAPSED());
    expect(stepTimeRange(fixed.steps[0])).toEqual(stepTimeRange(COLLAPSED().steps[0]));
    expect(stepMetric(fixed.steps[0], LATIN_UNITS)).toBe(stepMetric(COLLAPSED().steps[0], LATIN_UNITS));
  });

  it('is applied by normalization, on every write and read path', () => {
    const [normalized] = normalizeWorkoutParts({ workouts: [COLLAPSED()] }).workouts;
    expect(normalized.steps[0].durationMaxValue).toBe(5400);
  });
});

describe('the audit after the fix', () => {
  it('reports the repair instead of the collapse', () => {
    const codes = auditWorkout(autoFixWorkout(COLLAPSED())).map((f) => f.code);
    expect(codes).toContain('timeRangeFixed');
    expect(codes).not.toContain('collapsedTimeRange');
  });

  it('still warns when a session arrives unfixed', () => {
    const codes = auditWorkout(COLLAPSED()).map((f) => f.code);
    expect(codes).toContain('collapsedTimeRange');
    expect(codes).not.toContain('timeRangeFixed');
  });

  it('says nothing at all once the coach has undone it', () => {
    const codes = auditWorkout(undoAutoFixes(autoFixWorkout(COLLAPSED()))).map((f) => f.code);
    expect(codes).not.toContain('timeRangeFixed');
  });

  it('points the finding at the steps it changed', () => {
    const fixed = autoFixWorkout(COLLAPSED());
    expect(autoFixedSteps(fixed)).toEqual([fixed.steps[0]]);
  });
});
