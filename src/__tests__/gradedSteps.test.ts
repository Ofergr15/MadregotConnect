import { describe, expect, it } from 'vitest';
import {
  stepRole,
  isWorkStep,
  isSupportStep,
  isPacedStep,
  gradedSummary,
  flattenByRepetition,
  flattenWithRoles,
} from '@/lib/plans/graded-steps';
import type { WorkoutStep } from '@/lib/ai/types';

// One declaration of "what the verdict is about". The four graders that used to
// spell this out by hand now ask it, so these cases stand for all of them: a
// warm-up may never reach a pace verdict, and a recovery jog is not a failure.

const step = (over: Partial<WorkoutStep>): WorkoutStep =>
  ({ order: 1, type: 'active', durationType: 'distance', durationValue: 1000, ...over } as WorkoutStep);

describe('stepRole', () => {
  it('names the six step types the plan can carry', () => {
    expect(stepRole({ type: 'interval' })).toBe('work');
    expect(stepRole({ type: 'active' })).toBe('work');
    expect(stepRole({ type: 'warmup' })).toBe('support');
    expect(stepRole({ type: 'cooldown' })).toBe('support');
    expect(stepRole({ type: 'rest' })).toBe('rest');
    expect(stepRole({ type: 'recovery' })).toBe('rest');
  });

  it('reads a step the watch reported, not just a planned one', () => {
    // `dominantWatchStep` and `dominantBlock` hand this their own step shapes —
    // a device step and a graded block. Same words, so the same answer.
    expect(isSupportStep({ type: 'warmup', targetPaceMinPerKm: 280 })).toBe(true);
    expect(isWorkStep({ type: 'interval', targetPaceMinPerKm: 240 })).toBe(true);
  });

  it('keys off the type alone, so a paced open-ended block stays work', () => {
    // Folding "has anything measurable on it" into the role dropped
    // "easy at 5:00, lap when you're done" out of the pace band, which then fell
    // back on a pool that included the warm-up.
    expect(isWorkStep({ type: 'active', durationType: 'open' } as WorkoutStep)).toBe(true);
  });
});

describe('isPacedStep', () => {
  it('is a pace target with a number on it', () => {
    expect(isPacedStep({ targetType: 'pace', targetPaceMinPerKm: 265 })).toBe(true);
  });

  it('is not a step told to run hard without a number', () => {
    expect(isPacedStep({ targetType: 'no_target', targetPaceMinPerKm: null })).toBe(false);
    expect(isPacedStep({ targetType: 'pace' })).toBe(false);
  });
});

describe('gradedSummary', () => {
  // Sunday, as the club actually writes it: 2 km warm-up, 20 km at 4:25,
  // 8 × (15 s surge + 45 s walk).
  const sunday: WorkoutStep[] = [
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
    step({ order: 2, type: 'active', durationValue: 20000, targetType: 'pace', targetPaceMinPerKm: 265 }),
    step({
      order: 3,
      type: 'interval',
      repeatCount: 8,
      repeatSteps: [
        step({ order: 1, type: 'interval', durationType: 'time', durationValue: 15, targetType: 'no_target' }),
        step({ order: 2, type: 'rest', durationType: 'time', durationValue: 45, targetType: 'no_target' }),
      ],
    } as Partial<WorkoutStep>),
  ];

  it('leaves the warm-up out of the work kilometres and keeps it visible', () => {
    const s = gradedSummary(sunday);
    expect(s.supportKm.max).toBe(2);
    expect(s.workKm.min).toBeGreaterThanOrEqual(20);
    // The 20 km is the session; the closing 8 × 15 שנ׳ are strides after it.
    expect(s.counts).toMatchObject({ work: 1, drill: 8, support: 1, rest: 8 });
  });

  it('builds the pace band from the work alone', () => {
    // The whole point: the warm-up's 5:00–5:30 must not widen a 4:25 band to
    // 4:25–5:30, which is the range that told athletes they ran the session slow.
    expect(gradedSummary(sunday).paceBand).toEqual({ min: 265, max: 265 });
  });

  it('counts every repetition, not the block', () => {
    // 8 × (15 s + 45 s) is 8 work steps and 8 rests, not one of each.
    expect(flattenByRepetition(sunday)).toHaveLength(2 + 16);
  });

  it('has no pace band for a session of drills', () => {
    expect(gradedSummary([step({ durationType: 'open', targetType: 'no_target' })]).paceBand).toBeNull();
  });

  it('survives a session with no steps at all', () => {
    expect(gradedSummary([]).counts).toEqual({ work: 0, drill: 0, support: 0, rest: 0 });
  });
});

describe('flattenWithRoles', () => {
  // Friday as the club writes it: 2 km easy, 5 km @4:40–5:00, the 20 km medio,
  // 5 km @4:40–5:00, 2 km easy home. The parser types the opening `warmup` and
  // the closing one `active` — that last step is the whole reason this exists.
  const friday: WorkoutStep[] = [
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300 }),
    step({ order: 2, durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 300 }),
    step({ order: 3, durationValue: 20000, targetType: 'pace', targetPaceMinPerKm: 240 }),
    step({ order: 4, durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 300 }),
    step({ order: 5, durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300 }),
  ];

  it('demotes a jog home the plan never typed as one', () => {
    // The bug this exists for: the closing 2 km @5:00 counted as work and pulled
    // the band the medio is judged by out to 5:00.
    expect(flattenWithRoles(friday).map((l) => l.role)).toEqual(['support', 'work', 'work', 'work', 'support']);
    expect(gradedSummary(friday).paceBand).toEqual({ min: 240, max: 300 });
  });

  it('leaves an easy kilometre alone when the session continues after it', () => {
    // Same step, in the middle: nothing about it says jog home except position.
    const mid = [friday[2], friday[4], friday[2]];
    expect(flattenWithRoles(mid).map((l) => l.role)).toEqual(['work', 'work', 'work']);
  });

  it('demotes only a TYPED warm-up at the front, never an easy opening kilometre', () => {
    // Asymmetric on purpose, and the same asymmetry `workoutSections` has: a slow
    // opening 2 km is how a progressive run starts, and calling it a warm-up would
    // quietly drop the first leg of the session out of the verdict. A slow 2 km
    // with nothing after it can only be the way home.
    const opening = [step({ durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300 }), friday[2]];
    expect(flattenWithRoles(opening).map((l) => l.role)).toEqual(['work', 'work']);
  });

  it('never promotes a rest to support just for closing the session', () => {
    const withRest = [friday[2], step({ order: 2, type: 'rest', durationType: 'time', durationValue: 60 })];
    expect(flattenWithRoles(withRest).map((l) => l.role)).toEqual(['work', 'rest']);
  });

  it('reaches inside a repeat block', () => {
    expect(flattenWithRoles(sundayForRoles).map((l) => l.role)).toEqual([
      'support',
      'work',
      ...Array.from({ length: 8 }, () => ['drill', 'rest']).flat(),
    ]);
  });

  // Tuesday morning, verbatim: two easy kilometres, a walk, the 45 שנ׳ ladder down
  // to 3:20, another walk, 2 × (20 ש׳ מתגברת + 40 ש׳ הליכה) — and only then the
  // workout, which is three 2 ק״מ sets and 5 × 300 מ׳, with 1 km easy home.
  const rep = (n: number, legs: Partial<WorkoutStep>[]): WorkoutStep =>
    ({ order: 1, type: 'interval', repeatCount: n, repeatSteps: legs.map(step) } as WorkoutStep);
  const walk = (sec: number) => step({ type: 'rest', durationType: 'time', durationValue: sec });
  const tuesday: WorkoutStep[] = [
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300 }),
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 280 }),
    walk(120),
    ...[230, 220, 210, 200].map((p) =>
      step({ type: 'interval', durationType: 'time', durationValue: 45, targetType: 'pace', targetPaceMinPerKm: p })),
    walk(120),
    rep(2, [
      { type: 'interval', durationType: 'time', durationValue: 20 },
      { type: 'rest', durationType: 'time', durationValue: 40 },
    ]),
    rep(2, [
      { type: 'interval', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 215 },
      { type: 'recovery', durationType: 'time', durationValue: 180 },
    ]),
    rep(5, [
      { type: 'interval', durationValue: 300, targetType: 'pace', targetPaceMinPerKm: 210 },
      { type: 'rest', durationType: 'time', durationValue: 60 },
    ]),
    step({ type: 'active', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
  ];

  it('finds where the session actually starts on an interval day', () => {
    const roles = flattenWithRoles(tuesday).map((l) => l.role);
    expect(roles.slice(0, 11)).toEqual([
      'support', 'support', // 2 ק״מ + 2 ק״מ easy
      'rest',               // 2 דק׳ walk
      'drill', 'drill', 'drill', 'drill', // the 45 שנ׳ ladder
      'rest',               // 2 דק׳ walk
      'drill', 'rest', 'drill', // 2 × (20 ש׳ + 40 ש׳ walk), first legs
    ]);
    expect(roles.at(-1)).toBe('support'); // 1 ק״מ easy home
  });

  it('builds the pace band from the sets, not from the stride ladder', () => {
    // The bug in one line: the ladder's 3:20 is faster than every set in the
    // session, so it became the day's prescribed ceiling.
    const band = gradedSummary(tuesday).paceBand!;
    // 3:30 is the 5 × 300 מ׳, which genuinely is the session's fastest set.
    // 3:20 is the ladder, and the ladder is a warm-up.
    expect(band.min).toBe(210);
    expect(band.min).not.toBe(200);
  });

  it('counts strides and warm-up separately, and neither as the session', () => {
    const g = gradedSummary(tuesday);
    expect(g.workKm).toEqual({ min: 5.5, max: 5.5 }); // 2 × 2 ק״מ + 5 × 300 מ׳
    expect(g.supportKm).toEqual({ min: 5, max: 5 }); // 2 + 2 easy, 1 home
    expect(g.counts).toMatchObject({ work: 7, drill: 6 });
  });

  it('does not mistake a mid-session surge for a stride', () => {
    // Thursday: 6 × (9 דק׳ @4:25 + 1 דק׳ @3:40). The surge is the point of the
    // day and is the same length as a stride; position and the 9 דק׳ beside it
    // are what keep it in the verdict.
    const thursday: WorkoutStep[] = [
      step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 290 }),
      rep(6, [
        { type: 'interval', durationType: 'time', durationValue: 540, targetType: 'pace', targetPaceMinPerKm: 265 },
        { type: 'interval', durationType: 'time', durationValue: 60, targetType: 'pace', targetPaceMinPerKm: 220 },
      ]),
    ];
    const roles = flattenWithRoles(thursday).map((l) => l.role);
    expect(roles.filter((r) => r === 'drill')).toHaveLength(0);
    expect(gradedSummary(thursday).paceBand).toEqual({ min: 220, max: 265 });
  });

  it('keeps a session that is nothing but strides from grading as empty work', () => {
    // Saturday closes with 5 × (20 ש׳ מתגברת + 40 ש׳ הליכה) after an easy run;
    // the easy run is still the session.
    const saturday: WorkoutStep[] = [
      step({ type: 'active', durationType: 'time', durationValue: 2700, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330 }),
      rep(5, [
        { type: 'interval', durationType: 'time', durationValue: 20 },
        { type: 'rest', durationType: 'time', durationValue: 40 },
      ]),
    ];
    const roles = flattenWithRoles(saturday).map((l) => l.role);
    expect(roles[0]).toBe('work');
    expect(roles.filter((r) => r === 'drill')).toHaveLength(5);
  });

  const sundayForRoles: WorkoutStep[] = [
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300 }),
    step({ order: 2, durationValue: 20000, targetType: 'pace', targetPaceMinPerKm: 265 }),
    step({
      order: 3,
      type: 'interval',
      repeatCount: 8,
      repeatSteps: [
        step({ order: 1, type: 'interval', durationType: 'time', durationValue: 15 }),
        step({ order: 2, type: 'rest', durationType: 'time', durationValue: 45 }),
      ],
    } as Partial<WorkoutStep>),
  ];
});
