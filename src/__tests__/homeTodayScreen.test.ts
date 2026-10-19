import { describe, expect, it } from 'vitest';
import { lastWeekSummary, packPaces, rangeBar, runVerdict, steadyTarget, weeksSummary } from '@/lib/home/today';
import type { WorkoutStep } from '@/lib/ai/types';
import type { DailyDistance } from '@/lib/plans/workout-parsing';

// Real cases, 2026-10-19: Monday's one-day session for every pack, and Ofer's run that morning.
const MONDAY: WorkoutStep[] = [{
  type: 'active', order: 1, targetType: 'pace', durationType: 'time', durationValue: 3000, durationMaxValue: 4200,
  targetPaceMinPerKm: 280, targetPaceMaxPerKm: 315, group2Pace: { min: 280, max: 315 }, group3Pace: { min: 280, max: 315 },
} as WorkoutStep];

describe('steady target', () => {
  it('reads one block as time and pace for the pack', () => {
    expect(steadyTarget(MONDAY, null, 1)).toEqual({ kind: 'time', min: 3000, max: 4200, pace: { min: 280, max: 315 } });
  });
  it('has none for repeats', () => {
    const reps = [{ type: 'interval', order: 1, targetType: 'pace', durationType: 'distance', durationValue: 200, repeatCount: 15,
      repeatSteps: [{ type: 'interval', order: 1, targetType: 'pace', durationType: 'distance', durationValue: 200 }] }] as WorkoutStep[];
    expect(steadyTarget(reps, null, 1)).toBeNull();
  });
  it('ignores the warm-up around the block', () => {
    const steps = [{ type: 'warmup', order: 1, targetType: 'no_target', durationType: 'time', durationValue: 600 }, ...MONDAY] as WorkoutStep[];
    expect(steadyTarget(steps, null, 1)?.min).toBe(3000);
  });
});

describe('the run against its target', () => {
  const target = steadyTarget(MONDAY, null, 1)!;
  it('10.1 km in 52:35 is on plan', () => {
    expect(runVerdict(target, { seconds: 3155, meters: 10108 })).toBe('onPlan');
  });
  it('says which way it missed', () => {
    expect(runVerdict(target, { seconds: 3155, meters: 12000 })).toBe('fast');
    expect(runVerdict(target, { seconds: 2400, meters: 7000 })).toBe('slow');
    expect(runVerdict(target, { seconds: 2400, meters: 8000 })).toBe('short');
  });
  it('draws the target as the middle half of the track', () => {
    const t = rangeBar(3000, 4200, 3155);
    expect(t.from).toBe(25);
    expect(t.to).toBe(75);
    expect(t.inside).toBe(true);
    expect(rangeBar(280, 315, 312).at).toBeCloseTo(70.7, 0);
    expect(rangeBar(280, 315, 400).at).toBe(100);
  });
});

const day = (d: number, km: number, sessions: Array<[number, boolean?]> = [[km]]): DailyDistance => ({
  day: '', dayOfWeek: d, min: km, max: km, requiredMin: km, requiredMax: km, type: 'easy',
  sessions: sessions.map(([k, optional]) => ({ min: k, max: k, type: 'easy', name: '', optional: !!optional })),
});
const run = (km: number, seconds = km * 300) => ({ id: null, km, seconds, start: '' });

describe('last week', () => {
  // Group B, week of 11.10, against Ofer's runs.
  const plan = [day(0, 16), day(1, 11.7, [[11.7], [7.8, true]]), day(2, 48.7, [[23.1], [25.6]]), day(3, 17.5, [[17.5], [7.8, true]]), day(4, 11), day(5, 41), day(6, 8)];
  const km = [16.5, 10, 47.5, 4, 8, 40, 6];
  const runs = [[run(16.5)], [run(10)], [run(25.7), run(21.8)], [run(4)], [run(8)], [run(40, 10287)], [run(6)]];
  const s = lastWeekSummary(plan, km, runs);
  it('adds up', () => {
    expect(s.km).toBe(132);
    expect(s.plannedKm).toBe(153.9);
    expect(s.pct).toBe(86);
  });
  it('counts sessions, the double day as two, optional ones not at all', () => {
    expect(s.sessionsPlanned).toBe(8);
    expect(s.sessionsDone).toBe(8);
  });
  it('marks the dropped day only', () => {
    expect(s.days.filter((d) => d.missed).map((d) => d.dayOfWeek)).toEqual([3]);
  });
  it('finds the long run', () => {
    expect(s.longest).toEqual({ dayOfWeek: 5, km: 40, seconds: 10287 });
  });
});

describe('eight weeks', () => {
  const weeks = [60, 73.4, 37.1, 69.5, 93.3, 34.2, 114.2, 100.6, 132.1, 26.1].map((km, i) => ({ weekStart: `w${i}`, km }));
  it('leaves this unfinished week out and compares last week with the seven before it', () => {
    const w = weeksSummary(weeks)!;
    expect(w.weeks.map((x) => x.km)).toEqual([73.4, 37.1, 69.5, 93.3, 34.2, 114.2, 100.6, 132.1]);
    expect(w.avg).toBe(75);
    expect(w.delta).toBe(32);
    expect(w.biggest).toBe(true);
    expect(w.ratio).toBe(1.8);
  });
});

describe('run clock', () => {
  it('keeps the seconds', async () => {
    const { runClock } = await import('@/lib/home/today');
    expect(runClock(3155)).toBe('52:35');
    expect(runClock(10287)).toBe('2:51:27');
    expect(runClock(65)).toBe('1:05');
  });
});

describe('pace per pack', () => {
  // Tuesday 20.10 from the draft, read in lane 2: the lane's paces sit in the first slot.
  const TUESDAY = [
    { type: 'warmup', order: 1, targetType: 'pace', durationType: 'distance', durationValue: 3000, targetPaceMinPerKm: 280, targetPaceMaxPerKm: 280 },
    { type: 'interval', order: 2, targetType: 'pace', durationType: 'time', durationValue: 45, targetPaceMinPerKm: 240, targetPaceMaxPerKm: 240 },
    { type: 'interval', order: 2, targetType: 'pace', durationType: 'distance', durationValue: 1600, repeatCount: 2, targetPaceMinPerKm: 220, targetPaceMaxPerKm: 220,
      repeatSteps: [{ type: 'interval', order: 1, targetType: 'pace', durationType: 'distance', durationValue: 1600, targetPaceMinPerKm: 220, targetPaceMaxPerKm: 220 },
        { type: 'recovery', order: 2, targetType: 'no_target', durationType: 'distance', durationValue: 400 }] },
    { type: 'interval', order: 3, targetType: 'pace', durationType: 'distance', durationValue: 1600, targetPaceMinPerKm: 200, targetPaceMaxPerKm: 200 },
    { type: 'active', order: 4, targetType: 'pace', durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 },
  ] as WorkoutStep[];
  it('is the reps, not the strides before them or the jog home', () => {
    expect(packPaces(TUESDAY, 2)[1]).toEqual({ min: 200, max: 220 });
  });
  it("gives a lane's paces to its own pack only", () => {
    expect(packPaces(TUESDAY, 2)[0]).toBeNull();
    expect(packPaces(TUESDAY, 2)[2]).toBeNull();
  });
  it('passes a one-day session through, every pack its own', () => {
    expect(packPaces(MONDAY, null)).toEqual([{ min: 280, max: 315 }, { min: 280, max: 315 }, { min: 280, max: 315 }]);
  });
});
