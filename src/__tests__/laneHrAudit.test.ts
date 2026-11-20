import { describe, expect, it } from 'vitest';
import { auditLaneHr } from '@/lib/plans/lane-hr-audit';
import { splitIntoGroups } from '@/lib/ai/splitGroups';

/** Synthetic stored rows only. The audit reads; it never repairs or guesses intent. */

const pace = (s: number) => ({ targetType: 'pace', targetPaceMinPerKm: s, targetPaceMaxPerKm: s });
const step = (o: object) => ({ order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...o });

describe('auditLaneHr (read-only)', () => {
  it('flags the old split\'s signature as likely_flip: lane 1 pace, lane 2 heart_rate that still carries a pace', () => {
    const stored = {
      group1: { workouts: [{ dayOfWeek: 2, steps: [step(pace(225))] }] },
      group2: { workouts: [{ dayOfWeek: 2, steps: [step({ ...pace(235), targetType: 'heart_rate', targetHrMinPct: 150, targetHrMaxPct: 160 })] }] },
      group3: { workouts: [{ dayOfWeek: 2, steps: [step(pace(245))] }] },
    };
    expect(auditLaneHr(stored)).toEqual([{ lane: 2, dayOfWeek: 2, partIndex: null, path: [0], kind: 'likely_flip',
      lanePace: { min: 235, max: 235 }, laneHr: { min: 150, max: 160 } }]);
  });
  it('lane HR with no lane pace is ambiguous (could be the coach\'s own "2/3 by HR"), never a flip', () => {
    const stored = {
      group1: { workouts: [{ dayOfWeek: 3, steps: [step(pace(270))] }] },
      group2: { workouts: [{ dayOfWeek: 3, steps: [step({ targetType: 'heart_rate', targetHrMinPct: 150, targetHrMaxPct: 160 })] }] },
    };
    expect(auditLaneHr(stored).map(f => f.kind)).toEqual(['ambiguous']);
  });
  it('finds a flip inside a repeat, and keys the day by part', () => {
    const stored = {
      group1: { workouts: [{ dayOfWeek: 2, partIndex: 2, steps: [step({ targetType: 'no_target', repeatCount: 5, repeatSteps: [step(pace(225))] })] }] },
      group3: { workouts: [{ dayOfWeek: 2, partIndex: 2, steps: [step({ targetType: 'no_target', repeatCount: 5,
        repeatSteps: [step({ ...pace(245), targetType: 'heart_rate', targetHrMinPct: 145 })] })] }] },
    };
    expect(auditLaneHr(stored)).toMatchObject([{ lane: 3, partIndex: 2, path: [0, 0], kind: 'likely_flip' }]);
  });
  it('reports nothing for clean rows, HR-written steps, flat (unsplit) plans, or junk', () => {
    const clean = { group1: { workouts: [{ dayOfWeek: 1, steps: [step(pace(225)), step({ targetType: 'heart_rate', targetHrMinPct: 140 })] }] },
      group2: { workouts: [{ dayOfWeek: 1, steps: [step(pace(235)), step({ targetType: 'heart_rate', targetHrMinPct: 135 })] }] } };
    expect(auditLaneHr(clean)).toEqual([]);
    expect(auditLaneHr({ workouts: [] })).toEqual([]);
    for (const junk of [null, undefined, 5, 'x', {}]) expect(auditLaneHr(junk)).toEqual([]);
  });
  it('on a plan split by the FIXED splitIntoGroups, the old artefact no longer appears', () => {
    const plan = { workouts: [{ dayOfWeek: 2, steps: [step({ ...pace(225), group2Pace: { min: 235, max: 235 }, group2HeartRate: { min: 150, max: 160 } })] }] };
    expect(auditLaneHr(splitIntoGroups(plan as any))).toEqual([]);
  });

  it('a lane-2 HR step carrying exactly lane 1\'s pace is ambiguous (inherited, not written for the lane)', () => {
    const stored = {
      group1: { workouts: [{ dayOfWeek: 4, steps: [step(pace(270))] }] },
      group2: { workouts: [{ dayOfWeek: 4, steps: [step({ ...pace(270), targetType: 'heart_rate', targetHrMinPct: 150 })] }] },
    };
    expect(auditLaneHr(stored)).toMatchObject([{ kind: 'ambiguous', lanePace: null }]);
  });
});
