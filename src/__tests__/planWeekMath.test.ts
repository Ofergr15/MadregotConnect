import { describe, expect, it } from 'vitest';
import {
  planDayKey,
  formatPlanWeekRange,
  dedupeWorkoutsByDay,
  computeStepDistance,
  buildWeekBreakdown,
  buildWeekSessions,
} from '@/lib/plans/workout-parsing';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// First tests for workout-parsing.ts, which had none — and which every plan
// surface in the app derives its kilometres and its "next workout" from.

const step = (o: Partial<WorkoutStep>): WorkoutStep => ({
  order: 1, type: 'active', durationType: 'time', targetType: 'no_target', ...o,
});

const workout = (dayOfWeek: number, name: string, o: Partial<ParsedWorkout> = {}): ParsedWorkout => ({
  dayOfWeek, name, steps: [], ...o,
});

describe('planDayKey', () => {
  it('maps dayOfWeek onto the week it belongs to', () => {
    expect(planDayKey('2026-08-30', 0)).toBe('2026-08-30');
    expect(planDayKey('2026-08-30', 3)).toBe('2026-09-02');
    expect(planDayKey('2026-08-30', 6)).toBe('2026-09-05');
  });

  it('is timezone-independent across a DST change', () => {
    // Israel leaves IDT in late October. Pure UTC arithmetic, so the answer is the
    // same on a UTC server and in any viewer's browser — a local-Date version of
    // this returned 2026-10-30 for the last day of that week.
    expect(planDayKey('2026-10-25', 6)).toBe('2026-10-31');
  });
});

describe('formatPlanWeekRange', () => {
  it('renders the Sunday→Saturday range, zero-padded', () => {
    expect(formatPlanWeekRange('2026-09-06')).toBe('06.09 – 12.09');
  });

  it('carries across a month and a year boundary', () => {
    expect(formatPlanWeekRange('2026-08-30')).toBe('30.08 – 05.09');
    expect(formatPlanWeekRange('2026-12-27')).toBe('27.12 – 02.01');
  });

  it('is timezone-independent across a DST change', () => {
    // Same reason as planDayKey above: local-Date arithmetic drifted a day here.
    expect(formatPlanWeekRange('2026-10-25')).toBe('25.10 – 31.10');
  });
});

describe('dedupeWorkoutsByDay', () => {
  it('keeps a day\'s separate parts', () => {
    // The old rule was "first workout per dayOfWeek", which halved a double day.
    const kept = dedupeWorkoutsByDay([
      workout(2, 'Morning intervals'),
      workout(2, 'Evening easy'),
    ]);
    expect(kept.map(w => w.name)).toEqual(['Morning intervals', 'Evening easy']);
  });

  it('collapses a true duplicate', () => {
    const kept = dedupeWorkoutsByDay([
      workout(2, 'Morning intervals'),
      workout(2, 'Morning intervals'),
      workout(3, 'Morning intervals'),
    ]);
    expect(kept).toHaveLength(2);
    expect(kept.map(w => w.dayOfWeek)).toEqual([2, 3]);
  });
});

describe('computeStepDistance — timed steps with no coach pace', () => {
  it('credits a recovery at a recovery pace, not the working pace', () => {
    // 10 minutes. A rest/recovery interval used to be counted at 5:00–6:00/km, the
    // same as the reps it sits between, which inflated every interval session.
    const active = computeStepDistance(step({ type: 'active', durationValue: 600 }));
    const recovery = computeStepDistance(step({ type: 'recovery', durationValue: 600 }));
    const rest = computeStepDistance(step({ type: 'rest', durationValue: 600 }));

    expect(active).toEqual({ min: 1667, max: 2000 });   // 5:00–6:00 /km
    expect(recovery).toEqual({ min: 1111, max: 1429 }); // 7:00–9:00 /km
    expect(rest).toEqual(recovery);
    expect(recovery.max).toBeLessThan(active.min);
  });

  it('never inverts the range on a single-sided pace', () => {
    // Only a min, and a slow one (6:40/km). The generic `|| 360` max was FASTER
    // than the given min, so distMin came out above distMax.
    const d = computeStepDistance(step({ durationValue: 600, targetPaceMinPerKm: 400 }));
    expect(d.min).toBeLessThanOrEqual(d.max);
    expect(d).toEqual({ min: 1500, max: 1500 });
  });
});

describe('buildWeekBreakdown', () => {
  it('returns seven days, all rest, for a plan that is not there', () => {
    const b = buildWeekBreakdown(null);
    expect(b.dailyDistances).toHaveLength(7);
    expect(b.dailyDistances.every(d => d.max === 0 && d.type === 'rest')).toBe(true);
    expect(b.trainingDays).toBe(0);
    expect(b.weekTotalMax).toBe(0);
  });

  it('sums both sessions of a double day', () => {
    const b = buildWeekBreakdown({
      workouts: [
        workout(2, 'Morning intervals', { distanceMinKm: 8, distanceMaxKm: 10 }),
        workout(2, 'Evening easy run', { distanceMinKm: 5, distanceMaxKm: 6 }),
      ],
    });
    const tue = b.dailyDistances[2];
    expect(tue.sessions).toHaveLength(2);
    expect(tue.min).toBe(13);
    expect(tue.max).toBe(16);
    expect(b.trainingDays).toBe(1);
  });

  it('keeps typeDistribution in step with the week total', () => {
    // Five sessions whose midpoint is 8.05 km. Rounding each one first lost 50 m a
    // time, so the type split reported 40.5 against a week total of 40.3.
    const b = buildWeekBreakdown({
      workouts: [0, 1, 2, 3, 4].map(d =>
        workout(d, `Easy run ${d}`, { distanceMinKm: 8.05, distanceMaxKm: 8.05 }),
      ),
    });
    const splitTotal = Object.values(b.typeDistribution).reduce((s, n) => s + n, 0);
    const weekAvg = Math.round(((b.weekTotalMin + b.weekTotalMax) / 2) * 10) / 10;
    expect(splitTotal).toBe(weekAvg);
    expect(b.typeDistribution.easy).toBe(40.3);
  });

  it('rounds the day for display without losing the week', () => {
    // A day's own row is rounded to one decimal — "39.400000000000006 km" was on
    // screen — but the week is accumulated raw and rounded once at the end, so
    // the total still agrees with typeDistribution.
    const b = buildWeekBreakdown({
      workouts: [
        workout(2, 'Morning intervals', { distanceMinKm: 23.65, distanceMaxKm: 24.55 }),
        workout(2, 'Evening easy run', { distanceMinKm: 15.75, distanceMaxKm: 16.65 }),
      ],
    });
    expect(b.dailyDistances[2].min).toBe(39.4);
    expect(b.dailyDistances[2].max).toBe(41.2);
  });

  it('reads only group1 when the plan is split by group', () => {
    // extractWorkouts returns exactly ONE group's array; groups 2 and 3 come back
    // as per-step groupPaces, not as extra workouts. This is why a blind
    // first-per-day filter had nothing legitimate to remove.
    const b = buildWeekBreakdown({
      group1: { workouts: [workout(1, 'Tempo', { distanceMinKm: 10, distanceMaxKm: 10 })] },
      group2: { workouts: [workout(1, 'Tempo', { distanceMinKm: 9, distanceMaxKm: 9 })] },
      group3: { workouts: [workout(1, 'Tempo', { distanceMinKm: 8, distanceMaxKm: 8 })] },
    });
    expect(b.weekTotalMax).toBe(10);
    expect(b.trainingDays).toBe(1);
  });
});

describe('buildWeekSessions', () => {
  it('keeps every session, in the order they are run', () => {
    // Nine sessions on seven days. `keySessions`, which this replaces, was one
    // entry per DAY, so two of the week's runs had no representation at all —
    // and the Plan tab, which is a list of those entries, could not open them.
    const sessions = buildWeekSessions([
      workout(2, 'Evening', { partKind: 'evening', partIndex: 2, partCount: 2 }),
      workout(2, 'Morning', { partKind: 'morning', partIndex: 1, partCount: 2 }),
      workout(0, 'Long run'),
    ]);
    expect(sessions.map(s => s.name)).toEqual(['Long run', 'Morning', 'Evening']);
    expect(sessions.map(s => s.key)).toEqual(['day-0-part-1', 'day-2-part-1', 'day-2-part-2']);
  });

  it('names the earlier part of a day "morning" when only the later one is labelled', () => {
    // How Monday is actually parsed: part 1 is a plain 'single' and part 2 is
    // 'evening'. `sessionKind` alone calls part 1 "חלק 1/2", i.e. the day's main
    // run is labelled by a number while the optional add-on gets the real word.
    const [first, second] = buildWeekSessions([
      workout(1, 'Main run', { partKind: 'single', partIndex: 1, partCount: 2 }),
      workout(1, 'Optional evening', { partKind: 'evening', partIndex: 2, partCount: 2, optional: true }),
    ]);
    expect(first.kind).toBe('morning');
    expect(second.kind).toBe('evening');
    expect(second.optional).toBe(true);
  });

  it('leaves a single-session day unlabelled', () => {
    const [only] = buildWeekSessions([workout(3, 'Easy run')]);
    expect(only.kind).toBeNull();
    expect(only.partCount).toBe(1);
  });

  it('types each session from its own steps, not from its day', () => {
    const sessions = buildWeekSessions([
      workout(2, 'Morning intervals', { partKind: 'morning', partIndex: 1, partCount: 2 }),
      workout(2, 'Evening easy run', { partKind: 'evening', partIndex: 2, partCount: 2 }),
    ]);
    expect(sessions.map(s => s.type)).toEqual(['intervals', 'easy']);
  });

  it('carries its kilometres unrounded', () => {
    // Same rule as the week total: round for DISPLAY (`roundKm`), never in the
    // data, or nine sessions rounded up a decimal each stop adding up to the
    // week they belong to.
    const [s] = buildWeekSessions([workout(0, 'Long run', { distanceMinKm: 23.65, distanceMaxKm: 24.55 })]);
    expect(s.kmMin).toBe(23.65);
    expect(s.kmMax).toBe(24.55);
  });
});
