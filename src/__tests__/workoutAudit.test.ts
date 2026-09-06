import { describe, expect, it } from 'vitest';
import { auditWeek, auditWorkout, countWarnings, type AuditCode } from '@/lib/plans/workout-audit';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// Same source as stepEstimate.test.ts: the real sessions of the week of
// 2026-09-06 off `weekly_plans.parsed_workouts`. The findings asserted below are
// therefore findings about a plan that was actually published, not about a
// fixture written to trip the checks.

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
  return { dayOfWeek: 0, name: 'יום ראשון', steps, ...over } as ParsedWorkout;
}

const codes = (w: ParsedWorkout, opts?: Parameters<typeof auditWorkout>[1]): AuditCode[] =>
  auditWorkout(w, opts).map((f) => f.code);

/** Monday: 60 דק׳ at 4:50–5:30, coach's own "11 – 13 ק"מ" on the row. */
const MONDAY = workout(
  [step({ durationValue: 3600, notes: '60 דק׳ 4:50-5:30', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330 })],
  { distanceMinKm: 11, distanceMaxKm: 13 },
);

/** Monday evening: the whole prescription is one sentence of prose. */
const MONDAY_EVENING = workout([
  step({
    durationType: 'open', durationValue: undefined, targetType: 'no_target',
    notes: 'אופציה ל30-40 דק׳ קל בערב / כוח',
  }),
], { optional: true });

/** Tuesday evening: 20 × 500 מ׳, each group on its own pace. */
const TUESDAY_EVENING = workout([
  step({ order: 1, type: 'warmup', durationType: 'distance', durationValue: 3000, targetType: 'no_target', notes: 'חימום' }),
  step({
    order: 2, type: 'interval', durationValue: 0, repeatCount: 20,
    repeatSteps: [
      step({
        order: 1, durationType: 'distance', durationValue: 500,
        targetPaceMinPerKm: 205, group2Pace: { min: 215, max: 215 }, group3Pace: { min: 225, max: 225 },
      }),
      step({ order: 2, type: 'rest', durationValue: 60, targetType: 'no_target', notes: 'ג׳וג' }),
    ],
  }),
  step({ order: 3, type: 'cooldown', durationType: 'distance', durationValue: 1000, targetType: 'no_target', notes: 'שחרור' }),
]);

describe('auditWorkout — distance', () => {
  it('says nothing about a session the coach put a distance on', () => {
    expect(codes(MONDAY)).not.toContain('noDistance');
    expect(codes(MONDAY)).not.toContain('estimatedDistance');
  });

  it('marks the evening option as a distance this app worked out', () => {
    // 30–40 min at the club's easy band. The coach never wrote a kilometre here,
    // and the board is about to tell sixty athletes one.
    expect(codes(MONDAY_EVENING, { easyBand: { min: 290, max: 330 } })).toContain('estimatedDistance');
  });

  it('warns when there is genuinely nothing to go on', () => {
    const blank = workout([step({ durationType: 'open', durationValue: undefined, targetType: 'no_target' })]);
    const finding = auditWorkout(blank).find((f) => f.code === 'noDistance');
    expect(finding?.level).toBe('warn');
  });

  it('does not let a nominal open warmup pass for a distance', () => {
    // `assumeOpenBlocks` credits this with 1.5–2.5 km elsewhere on purpose; here
    // it would hide the one thing worth reporting.
    expect(codes(workout([
      step({ type: 'warmup', durationType: 'open', durationValue: undefined, targetType: 'no_target' }),
    ]))).toContain('noDistance');
  });
});

describe('auditWorkout — paces', () => {
  it('counts the steps whose groups really do differ', () => {
    const finding = auditWorkout(TUESDAY_EVENING).find((f) => f.code === 'groupPacesDiffer');
    expect(finding).toMatchObject({ count: 1, level: 'info' });
  });

  it('flags a week where no step differs at all', () => {
    // Every group getting the same board is legitimate and also the commonest
    // symptom of a bracket notation the parser missed.
    expect(codes(MONDAY)).toContain('groupPacesIdentical');
  });

  it('is silent on both when the session has no pace anywhere', () => {
    const c = codes(MONDAY_EVENING);
    expect(c).not.toContain('groupPacesIdentical');
    expect(c).not.toContain('groupPacesDiffer');
  });

  it('warns when ❷ is faster than ❶', () => {
    const finding = auditWorkout(workout([
      step({ targetPaceMinPerKm: 240, group2Pace: { min: 225, max: 225 } }),
    ])).find((f) => f.code === 'paceInversion');
    expect(finding).toMatchObject({ level: 'warn', count: 1, steps: [1] });
  });

  it('looks inside a repeat block for the inversion', () => {
    const inverted = workout([step({
      order: 4, durationValue: 0, repeatCount: 6,
      repeatSteps: [step({ order: 1, targetPaceMinPerKm: 265, group3Pace: { min: 255, max: 255 } })],
    })]);
    expect(auditWorkout(inverted).find((f) => f.code === 'paceInversion')?.steps).toEqual([1]);
  });

  it('does not call a step with only ❷ set an inversion', () => {
    expect(codes(workout([step({ targetType: 'no_target', targetPaceMinPerKm: undefined, group2Pace: { min: 215, max: 215 } })])))
      .not.toContain('paceInversion');
  });

  it('warns about a run step with neither a pace nor a word', () => {
    const finding = auditWorkout(workout([
      step({ order: 1, durationType: 'distance', durationValue: 2000, targetType: 'no_target' }),
    ])).find((f) => f.code === 'unpacedSteps');
    expect(finding).toMatchObject({ level: 'warn', steps: [1] });
  });

  it('accepts a note in place of a pace', () => {
    // "8 × 15 שנ׳ מתגברת" — strides have no pace and never will.
    expect(codes(workout([step({ durationValue: 15, targetType: 'no_target', notes: 'מתגברת' })])))
      .not.toContain('unpacedSteps');
  });

  it('does not ask a recovery jog for a pace', () => {
    expect(codes(workout([
      step({ order: 1, durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 290 }),
      step({ order: 2, type: 'rest', durationValue: 60, targetType: 'no_target' }),
    ]))).not.toContain('unpacedSteps');
  });
});

describe('auditWorkout — notes', () => {
  it('reports a note that only repeats the pace already on the row', () => {
    // Monday's note IS "60 דק׳ 4:50-5:30" — both halves of it are printed twice.
    const finding = auditWorkout(MONDAY).find((f) => f.code === 'duplicateNotes');
    expect(finding).toMatchObject({ level: 'info', count: 1 });
  });

  it('leaves a note that says something', () => {
    expect(codes(TUESDAY_EVENING)).not.toContain('duplicateNotes');
  });
});

describe('auditWorkout — shape', () => {
  it('notes a session that is one step and no structure', () => {
    expect(codes(MONDAY)).toContain('singleStep');
    expect(codes(TUESDAY_EVENING)).not.toContain('singleStep');
  });

  it('does not call a lone repeat block a single step', () => {
    expect(codes(workout([step({
      durationValue: 0, repeatCount: 8,
      repeatSteps: [step({ durationValue: 15, targetType: 'no_target', notes: 'מתגברת' })],
    })]))).not.toContain('singleStep');
  });

  it('puts warnings before observations', () => {
    const findings = auditWorkout(workout([
      step({ order: 1, durationType: 'distance', durationValue: 2000, targetType: 'no_target' }),
      step({ order: 2, targetPaceMinPerKm: 240, group2Pace: { min: 225, max: 225 } }),
    ]));
    const levels = findings.map((f) => f.level);
    expect(levels.indexOf('info')).toBeGreaterThan(levels.lastIndexOf('warn'));
    expect(countWarnings(findings)).toBe(2);
  });

  it('survives a session with no steps at all', () => {
    expect(() => auditWorkout(workout([]))).not.toThrow();
    expect(codes(workout([]))).toEqual(['noDistance']);
  });
});

describe('auditWeek', () => {
  const week = [MONDAY, MONDAY_EVENING, TUESDAY_EVENING];
  const audit = auditWeek(week, planEstimateOptions(week));

  it('keys findings the way a WeekSession is keyed', () => {
    expect(Object.keys(audit.byKey)).toEqual(['day-0-part-1', 'day-0-part-2', 'day-0-part-3']);
  });

  it('counts sessions, not findings', () => {
    // One session can hold three warnings and still be one session to look at.
    expect(audit.sessionsWithWarnings).toBe(0);
  });

  it('adds up the steps whose groups differ', () => {
    expect(audit.differingPaceSteps).toBe(1);
  });

  it('prefers the plan\'s own key when it has one', () => {
    const keyed = auditWeek([workout([], { workoutKey: 'w-mon-am' })]);
    expect(Object.keys(keyed.byKey)).toEqual(['w-mon-am']);
  });
});
