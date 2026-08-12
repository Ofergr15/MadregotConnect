import { describe, expect, it } from 'vitest';
import { normalizeWorkoutParts } from '@/lib/ai/parser';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import type { ParsedWeeklyPlan } from '@/lib/ai/types';

const tuesday: ParsedWeeklyPlan = {
  workouts: [
    {
      dayOfWeek: 2,
      name: 'חימום למבחן',
      partKind: 'warmup',
      steps: [
        {
          order: 1,
          type: 'warmup',
          durationType: 'distance',
          durationValue: 2000,
          targetType: 'pace',
          targetPaceMinPerKm: 300,
          targetPaceMaxPerKm: 300,
        },
      ],
    },
    {
      dayOfWeek: 2,
      name: 'מבחן 3000',
      partKind: 'test',
      expectedDistanceM: 3000,
      steps: [
        {
          order: 1,
          type: 'interval',
          durationType: 'distance',
          durationValue: 3000,
          targetType: 'pace',
          targetPaceMinPerKm: 210,
          targetPaceMaxPerKm: 210,
          group2Pace: { min: 220, max: 220 },
          group3Pace: { min: 230, max: 230 },
          notes: '3:30 (3:40) ((3:50))',
        },
      ],
    },
    {
      dayOfWeek: 2,
      name: 'המשך האימון',
      partKind: 'main',
      steps: [
        {
          order: 1,
          type: 'cooldown',
          durationType: 'distance',
          durationValue: 2000,
          targetType: 'no_target',
        },
      ],
    },
  ],
};

describe('multi-part workout normalization', () => {
  it('assigns stable ordered keys and matcher hints', () => {
    const result = normalizeWorkoutParts(tuesday);
    expect(result.workouts.map((workout) => workout.workoutKey)).toEqual([
      'day-2-part-1-warmup',
      'day-2-part-2-test',
      'day-2-part-3-main',
    ]);
    expect(result.workouts[1]).toMatchObject({
      partIndex: 2,
      partCount: 3,
      expectedDistanceM: 3000,
      distanceToleranceM: 240,
    });
  });

  it('preserves part identity while splitting group targets', () => {
    const grouped = splitIntoGroups(normalizeWorkoutParts(tuesday));
    for (const key of ['group1', 'group2', 'group3'] as const) {
      expect(grouped[key].workouts[1].workoutKey).toBe('day-2-part-2-test');
      expect(grouped[key].workouts[1].partCount).toBe(3);
    }
    expect(grouped.group1.workouts[1].steps[0].targetPaceMinPerKm).toBe(210);
    expect(grouped.group2.workouts[1].steps[0].targetPaceMinPerKm).toBe(220);
    expect(grouped.group3.workouts[1].steps[0].targetPaceMinPerKm).toBe(230);
  });
});
