import { describe, it, expect } from 'vitest';
import {
  durationRangeFromNotes,
  formatDurationShort,
  totalDurationSec,
  workoutDurationRangeSec,
  workoutDurationSec,
} from '@/lib/workout-duration';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The canonical per-workout duration. Its predecessors — three copies of
// `estimateTime()` in WeekView, WeekView's detail sheet and WorkoutPreview —
// summed `time` steps and ignored distance entirely, so the real Sunday below
// (23.5 km) was displayed as "8m" and the 120 km week as "3h59m". Every case in
// here is a session from the week of 2026-09-06.

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

describe('durationRangeFromNotes', () => {
  it('reads a Hebrew minutes range', () => {
    expect(durationRangeFromNotes('70-80 דק׳ ריצת שחרור קלה')).toEqual({ min: 4200, max: 4800 });
  });

  it('reads a single figure and an embedded one', () => {
    expect(durationRangeFromNotes('45 דקות קל')).toEqual({ min: 2700, max: 2700 });
    expect(durationRangeFromNotes('אופציה ל30-40 דק׳ קל בערב / כוח')).toEqual({ min: 1800, max: 2400 });
    expect(durationRangeFromNotes('20 min easy')).toEqual({ min: 1200, max: 1200 });
  });

  it('never mistakes a pace or a rep count for a duration', () => {
    // The reason the unit is required: these strings are all over the plan.
    expect(durationRangeFromNotes('4:50-5:30')).toBeNull();
    expect(durationRangeFromNotes('3:30 לא מהר מזה!')).toBeNull();
    expect(durationRangeFromNotes('מתגברת')).toBeNull();
    expect(durationRangeFromNotes(undefined)).toBeNull();
  });

  it('rejects a reversed range rather than returning a negative span', () => {
    expect(durationRangeFromNotes('80-70 דק׳')).toBeNull();
  });
});

describe('workoutDurationRangeSec', () => {
  it('converts a distance step with its own pace', () => {
    // 2 km @ 5:00–5:30 = 600–660s.
    expect(workoutDurationRangeSec(workout([
      step({ durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
    ]))).toEqual({ min: 600, max: 660 });
  });

  it('holds a single stated pace on both bounds', () => {
    // 20 km @ 4:25 is 4:25, not 4:25–6:00: falling back to the default slow bound
    // for the max would have added 32 minutes to Sunday.
    expect(workoutDurationRangeSec(workout([
      step({ durationValue: 20000, targetType: 'pace', targetPaceMinPerKm: 265 }),
    ]))).toEqual({ min: 5300, max: 5300 });
  });

  it('falls back to 5:00–6:00 for a distance step with no pace', () => {
    expect(workoutDurationRangeSec(workout([step({ durationValue: 1000 })])))
      .toEqual({ min: 300, max: 360 });
  });

  it('counts a time step as itself', () => {
    expect(workoutDurationRangeSec(workout([step({ durationType: 'time', durationValue: 2700 })])))
      .toEqual({ min: 2700, max: 2700 });
  });

  it('multiplies a repeat block by its count', () => {
    // Sunday's strides: 8 × (15s on + 45s walk) = 8 minutes.
    expect(workoutDurationRangeSec(workout([
      step({
        durationType: 'open',
        durationValue: undefined,
        repeatCount: 8,
        repeatSteps: [
          step({ type: 'interval', durationType: 'time', durationValue: 15 }),
          step({ type: 'rest', durationType: 'time', durationValue: 45 }),
        ],
      }),
    ]))).toEqual({ min: 480, max: 480 });
  });

  it('adds up the real Sunday instead of reporting only its strides', () => {
    const sunday = workout([
      step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
      step({ durationValue: 20000, targetType: 'pace', targetPaceMinPerKm: 265, targetPaceMaxPerKm: 265 }),
      step({
        durationType: 'open',
        durationValue: undefined,
        repeatCount: 8,
        repeatSteps: [
          step({ type: 'interval', durationType: 'time', durationValue: 15 }),
          step({ type: 'rest', durationType: 'time', durationValue: 45 }),
        ],
      }),
    ]);
    // 600–660 + 5300 + 480 = 6380–6440s. The card used to say 8m.
    expect(workoutDurationRangeSec(sunday)).toEqual({ min: 6380, max: 6440 });
    expect(formatDurationShort(workoutDurationSec(sunday))).toBe('1h47m');
  });

  it('is zero for a workout with nothing measurable', () => {
    expect(workoutDurationRangeSec(workout([step({ durationType: 'open', durationValue: undefined })])))
      .toEqual({ min: 0, max: 0 });
    expect(workoutDurationSec(workout([]))).toBe(0);
  });
});

describe('totalDurationSec', () => {
  it('sums the midpoints', () => {
    expect(totalDurationSec([
      workout([step({ durationType: 'time', durationValue: 1800 })]),
      workout([step({ durationType: 'open', durationValue: undefined, notes: '70-80 דק׳ קל' })]),
    ])).toBe(1800 + 4500);
  });
});

describe('formatDurationShort', () => {
  it('formats hours and minutes', () => {
    expect(formatDurationShort(6410)).toBe('1h47m');
    expect(formatDurationShort(3600)).toBe('1h');
    expect(formatDurationShort(2700)).toBe('45m');
  });

  it('rounds to minutes before splitting, so 3599s is an hour and not 60m', () => {
    expect(formatDurationShort(3599)).toBe('1h');
  });

  it('is empty rather than "0m" when there is no time', () => {
    expect(formatDurationShort(0)).toBe('');
    expect(formatDurationShort(-5)).toBe('');
  });
});
