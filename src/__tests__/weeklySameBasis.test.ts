import { describe, expect, it } from 'vitest';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';

/**
 * The weekly card's numbers on ONE basis (synthetic plan, owner-QA 2026-11-20): the type bars must sum to the
 * midpoint of the week's own range, which is what the week-over-week % is computed from. They used to be
 * re-estimated without the plan's own pace bands, so time-based sessions were priced twice, differently.
 */
const pace = (s: number) => ({ targetType: 'pace', targetPaceMinPerKm: s, targetPaceMaxPerKm: s + 20 });
const plan = { workouts: [
  // distance-written → measured, same either way
  { dayOfWeek: 0, name: 'Easy 12', steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 12000, ...pace(290) }] },
  // time-written, unpaced → ESTIMATED: this is where the two estimators differ
  { dayOfWeek: 1, name: 'Easy 70 min', steps: [{ order: 1, type: 'active', durationType: 'time', durationValue: 4200, targetType: 'no_target' }] },
  { dayOfWeek: 2, name: '6x1km', steps: [{ order: 1, type: 'interval', durationType: 'open', targetType: 'no_target', repeatCount: 6, repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(225) },
    { order: 2, type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' }] }] },
  { dayOfWeek: 4, name: 'Easy 50 min', steps: [{ order: 1, type: 'active', durationType: 'time', durationValue: 3000, targetType: 'no_target' }] },
  { dayOfWeek: 5, name: 'Long 26', steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 26000, ...pace(300) }] },
] };

describe('weekly card on one basis', () => {
  it('type bars sum to the midpoint of the range (rounding only)', () => {
    const b = buildWeekBreakdown(plan);
    const typesSum = Object.values(b.typeDistribution).reduce((a, x) => a + x, 0);
    const mid = (b.weekTotalMin + b.weekTotalMax) / 2;
    expect(Math.abs(typesSum - mid)).toBeLessThanOrEqual(0.05 * Object.keys(b.typeDistribution).length + 0.05);
  });
  it('daily maxima sum to the top of the range', () => {
    const b = buildWeekBreakdown(plan);
    const dailyMax = b.dailyDistances.reduce((a, d) => a + d.max, 0);
    expect(Math.abs(dailyMax - b.weekTotalMax)).toBeLessThanOrEqual(0.05 * 7);
  });
});
