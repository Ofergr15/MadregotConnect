import { describe, expect, it } from 'vitest';
import { enrichWithGroupPaces } from '@/lib/plans/workout-parsing';

/** A two-session day (Tuesday morning + evening): each session takes ITS OWN group 2/3 paces. */

const step = (pace: number, order = 1) => ({
  order, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace',
  targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace,
});
const day = (g: number, morning: number, evening: number, withParts = true) => [
  { dayOfWeek: 2, name: 'בוקר', ...(withParts ? { partIndex: 1 } : {}), steps: [step(morning + g * 10)] },
  { dayOfWeek: 2, name: 'ערב', ...(withParts ? { partIndex: 2 } : {}), steps: [step(evening + g * 10), step(evening + g * 10 + 5, 2)] },
];
const plan = (withParts = true) => ({
  workouts: day(0, 300, 240, withParts),
  group2: { workouts: day(1, 300, 240, withParts) },
  group3: { workouts: day(2, 300, 240, withParts) },
});
const paces = (w: { steps: { groupPaces?: ({ min: number } | null)[] }[] }) =>
  w.steps.map(s => (s.groupPaces || []).map(p => p?.min ?? null));

describe('enrichWithGroupPaces — two sessions on one day', () => {
  it('pairs by partIndex: the evening gets the evening paces for every group', () => {
    const [am, pm] = enrichWithGroupPaces(plan());
    expect(paces(am as any)).toEqual([[300, 310, 320]]);
    expect(paces(pm as any)).toEqual([[240, 250, 260], [245, 255, 265]]);
  });
  it('without partIndex, pairs by order within the day', () => {
    const [am, pm] = enrichWithGroupPaces(plan(false));
    expect(paces(am as any)).toEqual([[300, 310, 320]]);
    expect(paces(pm as any)).toEqual([[240, 250, 260], [245, 255, 265]]);
  });
  it('a flat plan (no group split) falls back to its own pace for all three', () => {
    const [, pm] = enrichWithGroupPaces({ workouts: day(0, 300, 240) });
    expect(paces(pm as any)).toEqual([[240, 240, 240], [245, 245, 245]]);
  });
});
