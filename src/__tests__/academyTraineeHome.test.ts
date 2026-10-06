import { describe, expect, it } from 'vitest';
import type { WorkoutStep } from '@/lib/ai/types';
import {
  goalCard, journeyPlanStats, kmAverage, monthsBetween, plannedPaceOf, resolveTraineePaces, rowPace, rowStatus,
  stepTiles, weekDates,
} from '@/lib/academy/trainee-home';
import { athletePrimaryOrder } from '@/lib/nav-items';

const step = (s: Partial<WorkoutStep>): WorkoutStep => ({
  order: 0, type: 'active', durationType: 'distance', targetType: 'no_target', ...s,
});

describe('rowStatus — the mark at the end of a week row', () => {
  const base = { date: '2026-10-05', today: '2026-10-06', distanceStatus: 'on_target', distancePct: 1, score: 91 };

  it('a run session is a ring with its accuracy', () => {
    expect(rowStatus({ ...base, completed: true })).toEqual({ kind: 'done', score: 91 });
  });

  it('a session short of the plan is partial, with the share of the distance', () => {
    expect(rowStatus({ ...base, completed: true, distanceStatus: 'under', distancePct: 0.62 }))
      .toEqual({ kind: 'partial', pct: 62 });
  });

  it('a past session not run is missed; today and later are still to come', () => {
    expect(rowStatus({ ...base, completed: false })).toEqual({ kind: 'missed' });
    expect(rowStatus({ ...base, date: '2026-10-06', completed: false })).toEqual({ kind: 'upcoming' });
    expect(rowStatus({ ...base, date: '2026-10-08', completed: false })).toEqual({ kind: 'upcoming' });
  });

  it('keeps an ungradeable run as done, without a number', () => {
    expect(rowStatus({ ...base, completed: true, score: null })).toEqual({ kind: 'done', score: null });
  });
});

describe('rowPace — which pace the sub-line judges', () => {
  it('a continuous run: the whole-run average against the graded band', () => {
    expect(rowPace({ averagePace: 331, comparedMin: 340, comparedMax: 340, toleranceSec: 5 }))
      .toEqual({ actual: 331, verdict: { kind: 'fast', deltaSec: 9 } });
  });

  it('an interval session: the reps, because the average is mostly the jog', () => {
    expect(rowPace({
      averagePace: 330, comparedMin: null, comparedMax: null,
      workPace: { actual: 248, min: 250, max: 250 }, toleranceSec: 5,
    })).toEqual({ actual: 248, verdict: { kind: 'on', deltaSec: 0 } });
  });

  it('no target at all: the average, unjudged', () => {
    expect(rowPace({ averagePace: 330, comparedMin: null, comparedMax: null, toleranceSec: 5 }))
      .toEqual({ actual: 330, verdict: null });
    expect(rowPace({ averagePace: null, comparedMin: null, comparedMax: null, toleranceSec: 5 })).toBeNull();
  });
});

describe('stepTiles — today, side by side', () => {
  it('warm-up · reps with their rest · cool-down', () => {
    const tiles = stepTiles({
      steps: [
        step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 340 }),
        step({
          type: 'interval', repeatCount: 6,
          repeatSteps: [
            step({ type: 'interval', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: 248, targetPaceMaxPerKm: 252 }),
            step({ type: 'rest', durationType: 'time', durationValue: 90 }),
          ],
        }),
        step({ type: 'cooldown', durationValue: 1500, targetType: 'pace', targetPaceMinPerKm: 350 }),
      ],
    });
    expect(tiles).toEqual([
      { kind: 'warmup', label: 'חימום 2 ק״מ', pace: 340 },
      { kind: 'main', label: '6 × 800 · מנוחה 1:30', pace: 250 },
      { kind: 'cooldown', label: 'שחרור 1.5 ק״מ', pace: 350 },
    ]);
  });

  it('nothing to split for one continuous step', () => {
    expect(stepTiles({ steps: [step({ durationValue: 10000, targetType: 'pace', targetPaceMinPerKm: 340 })] })).toEqual([]);
  });
});

describe('the km chart average', () => {
  it('leaves out the week in progress and the weeks before the first run', () => {
    const weeks = [0, 0, 20, 30, 40, 5].map((km, i) => ({ weekStart: `w${i}`, km }));
    expect(kmAverage(weeks)).toBe(30);
  });

  it('is null with nothing run', () => {
    expect(kmAverage([{ weekStart: 'a', km: 0 }, { weekStart: 'b', km: 4 }])).toBeNull();
  });
});

describe('journeyPlanStats', () => {
  const w = (weekStart: string, plannedCount: number, completedCount: number) => ({ weekStart, plannedCount, completedCount });

  it('counts the streak back from the last complete week, stepping over unplanned weeks', () => {
    const weeks = [
      w('2026-08-30', 5, 2), // 40% — breaks
      w('2026-09-06', 5, 4),
      w('2026-09-13', 0, 0), // no plan: neither counts nor breaks
      w('2026-09-20', 4, 4),
      w('2026-09-27', 5, 5),
      w('2026-10-04', 5, 1), // this week: not yet
    ];
    const stats = journeyPlanStats(weeks, '2026-10-04');
    expect(stats.streakWeeks).toBe(3);
    expect(stats.planPct).toBe(Math.round((16 / 24) * 100));
  });

  it('has no percentage before anything was planned', () => {
    expect(journeyPlanStats([w('2026-10-04', 0, 0)], '2026-10-04')).toEqual({ planPct: null, streakWeeks: 0 });
  });
});

describe('small helpers', () => {
  it('weekDates is Sunday to Saturday', () => {
    expect(weekDates('2026-10-04')).toEqual([
      '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    ]);
  });

  it('monthsBetween rounds to the half month', () => {
    expect(monthsBetween('2026-06-20', '2026-10-06')).toBe(3.5);
    expect(monthsBetween(null, '2026-10-06')).toBeNull();
  });

  it('plannedPaceOf is the band mid-point', () => {
    expect(plannedPaceOf(285, 295)).toBe(290);
    expect(plannedPaceOf(null, 295)).toBeNull();
  });
});

describe('goalCard', () => {
  it('names the race, the goal and counts the days down', () => {
    expect(goalCard({ goalType: 'half', targetRace: 'חצי מרתון טבריה', targetRaceDate: '2026-11-20' }, null, '2026-10-06'))
      .toEqual({ title: 'חצי מרתון טבריה', subtitle: 'היעד: חצי מרתון', daysLeft: 45 });
  });

  it('with no race shows the goal alone', () => {
    expect(goalCard({ goalType: '10k', targetRace: null, targetRaceDate: null }, { goal: 'סאב 50', paceProfile: {} }, '2026-10-06'))
      .toEqual({ title: '10 ק״מ', subtitle: 'היעד: סאב 50', daysLeft: null });
  });

  it('with nothing said there is no card, and a race already run has no countdown', () => {
    expect(goalCard(null, null, '2026-10-06')).toBeNull();
    expect(goalCard({ goalType: 'full', targetRace: 'ת״א', targetRaceDate: '2026-02-01' }, null, '2026-10-06')?.daysLeft).toBeNull();
  });
});

describe('resolveTraineePaces', () => {
  const band = (profile: Record<string, number>) => ({ bandNumber: 4, paceProfile: profile });

  it('takes the band threshold, shifted by how far the trainee sits from the band offset', () => {
    const asBand = resolveTraineePaces({ band: band({ thresholdPaceSec: 275, offsetSeconds: 10 }), athleteOffsetSec: null, testThresholdSec: null });
    const slower = resolveTraineePaces({ band: band({ thresholdPaceSec: 275, offsetSeconds: 10 }), athleteOffsetSec: 20, testThresholdSec: null });
    expect(asBand?.source).toBe('band');
    expect(asBand?.bandNumber).toBe(4);
    // Ten seconds on the threshold is ten seconds (±1 of rounding) on its zone.
    expect(Math.abs(slower!.threshold - asBand!.threshold - 10)).toBeLessThanOrEqual(1);
    // Easy is slower than threshold, interval faster.
    expect(asBand!.easy).toBeGreaterThan(asBand!.threshold);
    expect(asBand!.interval).toBeLessThan(asBand!.threshold);
  });

  it('falls back to the trainee\'s own latest test', () => {
    const p = resolveTraineePaces({ band: band({}), athleteOffsetSec: null, testThresholdSec: 275.4 });
    expect(p?.source).toBe('test');
    expect(p?.bandNumber).toBe(4);
  });

  it('invents nothing when neither is known', () => {
    expect(resolveTraineePaces({ band: band({ offsetSeconds: 0 }), athleteOffsetSec: 5, testThresholdSec: null })).toBeNull();
  });
});

describe('the phone tab bar for an academy member', () => {
  const ORDER = ['feed', 'dashboard', 'program', 'profile'];
  it('puts the academy where the program was', () => {
    expect(athletePrimaryOrder(ORDER, true)).toEqual(['feed', 'dashboard', 'academy', 'profile']);
  });
  it('leaves everybody else alone', () => {
    expect(athletePrimaryOrder(ORDER, false)).toEqual(ORDER);
  });
});
