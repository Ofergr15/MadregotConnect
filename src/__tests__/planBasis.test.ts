import { describe, expect, it } from 'vitest';
import type { WorkoutStep } from '@/lib/ai/types';
import { DISPLAY_REFERENCE, planPaceBasis } from '@/lib/academy/plan-basis';
import { plannedLegs, plannedLoad, restateOptions, restateSteps } from '@/lib/academy/load';
import { laneReferences } from '@/lib/academy/senior-pick';
import { watchRange, watchRangeKind } from '@/lib/academy/watch-range';

/**
 * Whose paces a plan is in (plan-basis.ts), the steps restated to the trainee's, and the
 * one set of legs the card's minutes, the plan column and the ⚡ are all read from.
 */

const REFS = { 1: 240, 2: 260, 3: 280, 4: 300 } as const;
const pace = (sec: number) => ({ targetType: 'pace' as const, targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const REPS: WorkoutStep[] = [
  { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, ...pace(340) },
  {
    order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 5,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(245) },
      { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' },
    ],
  },
  { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, ...pace(340) },
];

describe('planPaceBasis', () => {
  it('the trainee\'s own plan is as stored', () => {
    expect(planPaceBasis({ planAthleteId: 'me', parsedWorkouts: null, groupName: null, laneRefs: REFS, thresholdSec: 252 }))
      .toEqual({ fromClub: false, referenceSec: 252, drawAtSec: 252, scale: 1 });
  });

  it('a unified club week is lane 1\'s, restated to the trainee\'s threshold', () => {
    const b = planPaceBasis({ planAthleteId: null, parsedWorkouts: { workouts: [] }, groupName: null, laneRefs: REFS, thresholdSec: 300 });
    expect(b).toEqual({ fromClub: true, referenceSec: 240, drawAtSec: 300, scale: 300 / 240 });
  });

  it('with no test there is nothing to restate to', () => {
    const b = planPaceBasis({ planAthleteId: null, parsedWorkouts: { workouts: [] }, groupName: null, laneRefs: REFS, thresholdSec: null });
    expect(b.scale).toBe(1);
    expect(planPaceBasis({ planAthleteId: 'me', parsedWorkouts: null, groupName: null, laneRefs: null, thresholdSec: null }).referenceSec).toBe(DISPLAY_REFERENCE);
  });

  it('a per-group club week is the group\'s lane', () => {
    const refs = laneReferences();
    const b = planPaceBasis({ planAthleteId: null, parsedWorkouts: { group2: {} }, groupName: null, laneRefs: refs, thresholdSec: 252 });
    expect(b.referenceSec).toBe(refs[1]);
  });
});

describe('restateSteps', () => {
  it('moves every pace, nested ones too, and nothing else', () => {
    const r = restateSteps(REPS, 1.2);
    expect(r[0].targetPaceMinPerKm).toBe(408);
    expect(r[1].repeatSteps![0].targetPaceMinPerKm).toBe(294);
    expect(r[1].repeatSteps![1].durationValue).toBe(120);
    expect(r[0].durationValue).toBe(2000);
    expect(REPS[0].targetPaceMinPerKm).toBe(340);
  });

  it('scale 1 is the same array; the bands follow', () => {
    expect(restateSteps(REPS, 1)).toBe(REPS);
    const o = restateOptions({ easyBand: { min: 300, max: 340 } }, 1.1);
    expect(o.easyBand!.min).toBeCloseTo(330);
    expect(o.easyBand!.max).toBeCloseTo(374);
  });

  it('a slower restatement is less ⚡ against the same threshold', () => {
    expect(plannedLoad(restateSteps(REPS, 1.2), 252)).toBeLessThan(plannedLoad(REPS, 252));
  });
});

describe('plannedLegs', () => {
  it('the jogs are between the reps: four, not five', () => {
    const legs = plannedLegs(REPS);
    expect(legs.map(l => l.times)).toEqual([1, 5, 4, 1]);
  });

  it('a lone jog in a repeat of one step still counts every time', () => {
    const legs = plannedLegs([{ order: 1, type: 'interval', durationType: 'open', targetType: 'no_target', repeatCount: 3, repeatSteps: [{ order: 1, type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target' }] }]);
    expect(legs[0].times).toBe(3);
  });
});

describe('watchRangeKind', () => {
  it('easy for warmup, cooldown and jogs; work for intervals, work zones and reps', () => {
    expect(watchRangeKind({ type: 'warmup' })).toBe('easy');
    expect(watchRangeKind({ type: 'recovery' }, true)).toBe('easy');
    expect(watchRangeKind({ type: 'interval' })).toBe('work');
    expect(watchRangeKind({ type: 'active', targetZone: 'tempo' })).toBe('work');
    expect(watchRangeKind({ type: 'active', targetZone: 'easy' })).toBe('easy');
    expect(watchRangeKind({ type: 'active' })).toBe('easy');
    expect(watchRangeKind({ type: 'active' }, true)).toBe('work');
    expect(watchRange({ targetPaceMinPerKm: 245 }, watchRangeKind({ type: 'interval' }))).toEqual({ min: 241, max: 249 });
  });
});
