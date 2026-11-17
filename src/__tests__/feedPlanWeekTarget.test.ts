import { describe, expect, it } from 'vitest';
import { planWeekTarget } from '@/lib/feed/plan-week-target';
import { ringNumbers } from '@/lib/plans/week-tab';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import { laneWorkouts } from '@/lib/academy/group-lane';

// P1 #13: the feed card's "מתוך X" used weekTotalMin over group 1 — the optional
// evening counted into the floor, and every lane got lane 1's week — while the
// profile ring above it showed the lane's floor–ceiling band.

const g = (sunMin: number, sunMax: number) => ({
  workouts: [
    { dayOfWeek: 0, name: 'יום ראשון', distanceMinKm: sunMin, distanceMaxKm: sunMax, steps: [] },
    { dayOfWeek: 1, name: 'יום שני', distanceMinKm: 11, distanceMaxKm: 13, steps: [] },
    { dayOfWeek: 1, name: 'יום שני - ערב אופציה', distanceMinKm: 8, distanceMaxKm: 10, steps: [] },
  ],
});
const perGroup = { group1: g(23, 24), group2: g(20, 21), group3: g(17, 18) };

describe('planWeekTarget', () => {
  it('floors on the prescribed sessions, not the optional evening', () => {
    // Old code: weekTotalMin = 23 + 11 + 8 = 42.
    expect(planWeekTarget(g(23, 24), null)).toEqual({ targetMin: 34, targetMax: 47 });
  });

  it("reads the member's own lane, not group 1", () => {
    expect(planWeekTarget(perGroup, 2)).toEqual({ targetMin: 31, targetMax: 44 });
    expect(planWeekTarget(perGroup, 3)).toEqual({ targetMin: 28, targetMax: 41 });
  });

  it('agrees with the profile ring for the same lane', () => {
    const plan = { hasPlan: true, hasClubPlan: true, ...buildWeekBreakdown({ workouts: laneWorkouts(perGroup, 2) }) };
    const { target } = ringNumbers({ today: 0, km: 0, avgKm: 0 } as never, plan as never);
    const feed = planWeekTarget(perGroup, 2);
    expect([feed.targetMin, feed.targetMax]).toEqual([target!.min, target!.max]);
  });

  it('returns 0/0 for a plan with no distance', () => {
    expect(planWeekTarget({ workouts: [] }, 1)).toEqual({ targetMin: 0, targetMax: 0 });
  });
});
