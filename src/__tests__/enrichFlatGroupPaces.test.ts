import { describe, it, expect } from 'vitest';
import { enrichWithGroupPaces } from '@/lib/plans/workout-parsing';

const day = (steps: any[]) => ({ workouts: [{ dayOfWeek: 2, name: 'Tue', type: 'tempo', steps }] });
const paces = (w: any[], i = 0) => w[0].steps[i].groupPaces;

describe('enrichWithGroupPaces — flat plans keep each pack its own pace', () => {
  it('reads group2Pace / group3Pace off the step', () => {
    const out = enrichWithGroupPaces(day([{ type: 'active', durationType: 'distance', durationValue: 20000, targetType: 'pace',
      targetPaceMinPerKm: 265, targetPaceMaxPerKm: 265, group2Pace: { min: 275, max: 275 }, group3Pace: { min: 285, max: 285 } }]));
    expect(paces(out)).toEqual([{ min: 265, max: 265 }, { min: 275, max: 275 }, { min: 285, max: 285 }]);
  });

  it('reads the bracket notes when the step has no lane fields', () => {
    const out = enrichWithGroupPaces(day([{ type: 'active', durationType: 'distance', durationValue: 3000, targetType: 'no_target',
      notes: '3 ק״מ 4:25 (4:35) ((4:45))' }]));
    expect(paces(out).map((p: any) => p?.min)).toEqual([265, 275, 285]);
  });

  it('reaches repeat children', () => {
    const out = enrichWithGroupPaces(day([{ type: 'interval', durationType: 'open', repeatCount: 6, repeatSteps: [
      { type: 'interval', durationType: 'distance', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: 210, targetPaceMaxPerKm: 210,
        group2Pace: { min: 220, max: 220 }, group3Pace: { min: 230, max: 230 } }] }]));
    expect(out[0].steps[0].repeatSteps![0] as any).toMatchObject({ groupPaces: [{ min: 210 }, { min: 220 }, { min: 230 }] });
  });

  it('ignores notes whose group-1 pace disagrees with the step', () => {
    const out = enrichWithGroupPaces(day([{ type: 'active', durationType: 'distance', durationValue: 3000, targetType: 'pace',
      targetPaceMinPerKm: 210, targetPaceMaxPerKm: 210, notes: 'later 4:25 (4:35) ((4:45))' }]));
    expect(paces(out)).toEqual([{ min: 210, max: 210 }, { min: 210, max: 210 }, { min: 210, max: 210 }]);
  });

  it('a split plan still reads its own groups', () => {
    const g = (p: number) => ({ workouts: [{ dayOfWeek: 2, name: 'Tue', type: 'tempo', steps: [{ type: 'active', durationType: 'distance',
      durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: p, targetPaceMaxPerKm: p }] }] });
    const out = enrichWithGroupPaces({ group1: g(200), group2: g(210), group3: g(220) });
    expect(paces(out).map((p: any) => p.min)).toEqual([200, 210, 220]);
  });
});
