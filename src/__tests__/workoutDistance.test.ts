import { describe, it, expect } from 'vitest';
import {
  totalDistanceMeters,
  workoutDistanceMeters,
  workoutDistanceRangeMeters,
} from '@/lib/workout-distance';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The canonical per-workout distance, shared by the planner (WeekView /
// WorkoutPreview) and the athlete dashboard "so their weekly km ALWAYS agree".
// A disagreement here shows up as the coach and the athlete reading two different
// numbers off the same week, which is why the sharing exists at all.

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[], over: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return { dayOfWeek: 0, name: 'Run', steps, ...over } as ParsedWorkout;
}

describe('workoutDistanceRangeMeters', () => {
  it('takes the coach\'s range as the source of truth', () => {
    // The "9 – 11 ק"מ" in the PDF header outranks the transcribed steps.
    expect(workoutDistanceRangeMeters(workout([step({ durationValue: 1000 })], {
      distanceMinKm: 9, distanceMaxKm: 11,
    }))).toEqual({ min: 9000, max: 11_000 });
  });

  it('mirrors a single stated figure into both bounds', () => {
    expect(workoutDistanceRangeMeters(workout([], { distanceMinKm: 10 })))
      .toEqual({ min: 10_000, max: 10_000 });
    expect(workoutDistanceRangeMeters(workout([], { distanceMaxKm: 10 })))
      .toEqual({ min: 10_000, max: 10_000 });
  });

  it('sums distance steps when the coach stated nothing', () => {
    expect(workoutDistanceRangeMeters(workout([
      step({ durationValue: 2000 }),
      step({ durationValue: 3000 }),
    ]))).toEqual({ min: 5000, max: 5000 });
  });

  it('converts a timed step through its pace band, faster pace giving more distance', () => {
    // 30 min between 4:00 and 5:00/km → 6.0 km down to 7.5 km.
    expect(workoutDistanceRangeMeters(workout([
      step({ durationType: 'time', durationValue: 1800, targetType: 'pace', targetPaceMinPerKm: 240, targetPaceMaxPerKm: 300 }),
    ]))).toEqual({ min: 6000, max: 7500 });
  });

  it('assumes 5:00–6:00/km for a timed step with no pace target', () => {
    // 60 min easy with nothing prescribed → 10 to 12 km.
    expect(workoutDistanceRangeMeters(workout([
      step({ durationType: 'time', durationValue: 3600 }),
    ]))).toEqual({ min: 10_000, max: 12_000 });
  });

  it('multiplies a repeat block by its count', () => {
    expect(workoutDistanceRangeMeters(workout([
      step({
        durationType: 'open',
        repeatCount: 6,
        repeatSteps: [
          step({ durationValue: 400, type: 'interval' }),
          step({ durationValue: 200, type: 'recovery' }),
        ],
      }),
    ]))).toEqual({ min: 3600, max: 3600 });
  });

  it('counts the recoveries inside a repeat, because the athlete still runs them', () => {
    const withRecovery = workoutDistanceRangeMeters(workout([
      step({ durationType: 'open', repeatCount: 4, repeatSteps: [step({ durationValue: 400 }), step({ durationValue: 200, type: 'recovery' })] }),
    ]));
    expect(withRecovery.min).toBe(2400);
  });

  it('expands nested repeats', () => {
    // 3 × (2 × 400 m) = 2400 m.
    expect(workoutDistanceRangeMeters(workout([
      step({
        durationType: 'open',
        repeatCount: 3,
        repeatSteps: [
          step({ durationType: 'open', repeatCount: 2, repeatSteps: [step({ durationValue: 400 })] }),
        ],
      }),
    ]))).toEqual({ min: 2400, max: 2400 });
  });

  it('contributes nothing for an open-ended step, rather than guessing', () => {
    expect(workoutDistanceRangeMeters(workout([
      step({ durationType: 'open', type: 'warmup' }),
      step({ durationValue: 5000 }),
    ]))).toEqual({ min: 5000, max: 5000 });
  });

  it('is zero for a workout with no steps at all', () => {
    expect(workoutDistanceRangeMeters(workout([]))).toEqual({ min: 0, max: 0 });
  });

  it('mixes a timed step with a measured one', () => {
    // 2 km warmup + 20 min at 5:00/km flat.
    expect(workoutDistanceRangeMeters(workout([
      step({ type: 'warmup', durationValue: 2000 }),
      step({ durationType: 'time', durationValue: 1200, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }),
    ]))).toEqual({ min: 6000, max: 6000 });
  });
});

describe('workoutDistanceMeters', () => {
  it('is the midpoint of the range', () => {
    expect(workoutDistanceMeters(workout([], { distanceMinKm: 9, distanceMaxKm: 12 }))).toBe(10_500);
  });

  it('rounds to a whole metre', () => {
    // 9–10 km midpoint 9500; an odd range must not leak a fraction into the UI.
    expect(workoutDistanceMeters(workout([], { distanceMinKm: 9, distanceMaxKm: 10.001 })))
      .toBe(9501);
  });
});

describe('totalDistanceMeters', () => {
  it('adds the midpoints across a week', () => {
    expect(totalDistanceMeters([
      workout([step({ durationValue: 8000 })]),
      workout([], { distanceMinKm: 9, distanceMaxKm: 11 }),
      workout([step({ durationType: 'open' })]),
    ])).toBe(18_000);
  });

  it('is zero for an empty week', () => {
    expect(totalDistanceMeters([])).toBe(0);
  });
});
