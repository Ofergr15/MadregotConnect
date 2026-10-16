import { describe, expect, it } from 'vitest';
import { mainSet, onTarget, segmentsFromSteps, withTargets } from '@/lib/share/plan-segments';
import type { StoredLap } from '@/lib/garmin/laps';
import type { ExecutedWorkout } from '@/lib/garmin/executed-workout';

const lap = (distance: number, pace: number, wktStepIndex?: number, intensityType?: string, hr?: number): StoredLap => ({
  distance, duration: (distance / 1000) * pace, averagePace: null, averageHR: hr ?? null, maxHR: null,
  wktStepIndex, intensityType,
});

describe('segmentsFromSteps', () => {
  it('rebuilds 5 km blocks from 1 km auto-laps (2026-10-16, 7 × 5 km)', () => {
    const laps = [
      lap(1000, 300, 0, 'WARMUP'), lap(1000, 300, 0, 'WARMUP'),
      ...[1, 2].flatMap(step => Array.from({ length: 5 }, () => lap(1000, step === 1 ? 230 : 250, step, 'ACTIVE'))),
    ];
    const segs = segmentsFromSteps(laps, null)!;
    expect(segs.map(s => [s.m, s.pace, s.kind])).toEqual([
      [2000, 300, 'warmup'], [5000, 230, 'active'], [5000, 250, 'active'],
    ]);
  });

  it('gives the same blocks when auto-lap was off', () => {
    const segs = segmentsFromSteps([lap(5000, 230, 1, 'ACTIVE'), lap(5000, 250, 2, 'ACTIVE')], null)!;
    expect(segs.map(s => s.m)).toEqual([5000, 5000]);
  });

  it('cuts a repeated single step into its iterations by the step length', () => {
    const workout: ExecutedWorkout = {
      name: null, createdAt: null,
      steps: [{ stepIndex: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', distanceM: 2000 }],
    };
    const laps = Array.from({ length: 6 }, () => lap(1000, 240, 1, 'ACTIVE'));
    expect(segmentsFromSteps(laps, workout)!.map(s => s.m)).toEqual([2000, 2000, 2000]);
  });

  it('keeps laps after the workout ended as free running, and HR time-weighted', () => {
    const segs = segmentsFromSteps([lap(1000, 240, 1, 'ACTIVE', 150), lap(3000, 240, 1, 'ACTIVE', 170), lap(800, 330)], null)!;
    expect(segs[0].hr).toBe(165);
    expect(segs[1].kind).toBe('free');
  });

  it('is null for a run not started from a workout', () => {
    expect(segmentsFromSteps([lap(1000, 300), lap(1000, 300)], null)).toBeNull();
  });
});

describe('mainSet', () => {
  it('drops the warm-up, the strides and the walks', () => {
    const segs = segmentsFromSteps([
      lap(3000, 280, 1, 'WARMUP'), lap(200, 230, 3, 'INTERVAL'), lap(150, 600, 4, 'RECOVERY'),
      lap(5000, 230, 5, 'ACTIVE'), lap(5000, 250, 6, 'ACTIVE'), lap(700, 330),
    ], null)!;
    expect(mainSet(segs).map(s => s.m)).toEqual([5000, 5000]);
  });

  it('keeps short reps when they are the session', () => {
    const laps = [1, 2, 3].flatMap(i => [lap(400, 200, i * 2, 'ACTIVE'), lap(200, 400, i * 2 + 1, 'RECOVERY')]);
    expect(mainSet(segmentsFromSteps(laps, null)!).map(s => s.m)).toEqual([400, 400, 400]);
  });
});

describe('withTargets', () => {
  // The 2026-10-16 notes: three lanes in one note, "3:40 (3:50) ((4:00))".
  const workout: ExecutedWorkout = {
    name: null, createdAt: null,
    steps: [
      { stepIndex: 1, intensity: 'WARMUP', durationType: 'OPEN' },
      { stepIndex: 2, intensity: 'ACTIVE', durationType: 'DISTANCE', distanceM: 5000, notes: '3:40 (3:50) ((4:00))' },
      { stepIndex: 3, intensity: 'RECOVERY', durationType: 'TIME', durationSec: 60, notes: 'הליכה' },
    ],
  };
  const segs = segmentsFromSteps([lap(2000, 300, 1, 'WARMUP'), lap(5000, 238, 2, 'ACTIVE'), lap(150, 600, 3, 'RECOVERY')], workout)!;

  it("reads the step's note at the athlete's lane", () => {
    expect(withTargets(segs, workout, 3)[1].target).toEqual({ min: 240, max: 240 });
    expect(withTargets(segs, workout, 1)[1].target).toEqual({ min: 220, max: 220 });
  });

  it('gives a walk and an open warm-up no target', () => {
    const t = withTargets(segs, workout, 2);
    expect(t[0].target).toBeUndefined();
    expect(t[2].target).toBeUndefined();
  });

  it('counts a block on target at or faster than the slow edge, with 3 s of grace', () => {
    expect(onTarget({ pace: 238, target: { min: 240, max: 240 } })).toBe(true);
    expect(onTarget({ pace: 243, target: { min: 240, max: 240 } })).toBe(true);
    expect(onTarget({ pace: 244, target: { min: 240, max: 240 } })).toBe(false);
    expect(onTarget({ pace: 200 })).toBe(false);
  });
});
