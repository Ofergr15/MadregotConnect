import { describe, it, expect } from 'vitest';
import { splitIntoGroups } from '../lib/ai/splitGroups';
import type { ParsedWeeklyPlan } from '../lib/ai/types';

// Regression: coach writes bracket paces with en-dashes and spaces
// ("3:20 – 3:15 (3:30 – 3:25) ((3:40 – 3:30))"). The old [\d:] / plain-hyphen
// regexes didn't match, so all groups got identical pace + un-rewritten notes.
describe('group split handles en-dash bracket notation', () => {
  const plan: ParsedWeeklyPlan = {
    workouts: [{ dayOfWeek: 4, name: 'יום חמישי', steps: [
      { order: 1, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'pace',
        targetPaceMinPerKm: 195, targetPaceMaxPerKm: 200,
        notes: '3:20 – 3:15 (3:30 – 3:25) ((3:40 – 3:30))' },
    ]}],
  };

  it('distinct per-group paces (normalized fast-first)', () => {
    const g = splitIntoGroups(plan);
    const s = (k: 'group1'|'group2'|'group3') => g[k].workouts[0].steps[0];
    expect([s('group1').targetPaceMinPerKm, s('group1').targetPaceMaxPerKm]).toEqual([195, 200]);
    expect([s('group2').targetPaceMinPerKm, s('group2').targetPaceMaxPerKm]).toEqual([205, 210]);
    expect([s('group3').targetPaceMinPerKm, s('group3').targetPaceMaxPerKm]).toEqual([210, 220]);
  });

  it('per-group notes rewritten to that group segment only', () => {
    const g = splitIntoGroups(plan);
    expect(g.group1.workouts[0].steps[0].notes).toBe('3:20 – 3:15');
    expect(g.group2.workouts[0].steps[0].notes).toBe('3:30 – 3:25');
    expect(g.group3.workouts[0].steps[0].notes).toBe('3:40 – 3:30');
  });
});
