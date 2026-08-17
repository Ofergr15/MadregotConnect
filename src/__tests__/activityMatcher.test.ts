import { describe, expect, it } from 'vitest';
import { matchActivityParts } from '@/lib/plans/activity-matcher';
import type { ParsedWorkout } from '@/lib/ai/types';

const parts: ParsedWorkout[] = [
  {
    dayOfWeek: 2,
    name: 'Warmup',
    workoutKey: 'warmup',
    partIndex: 1,
    partCount: 3,
    expectedDistanceM: 2000,
    distanceToleranceM: 300,
    steps: [],
  },
  {
    dayOfWeek: 2,
    name: '3000 test',
    workoutKey: 'test',
    partIndex: 2,
    partCount: 3,
    expectedDistanceM: 3000,
    distanceToleranceM: 200,
    activityNameTokens: ['3000', 'test'],
    steps: [],
  },
  {
    dayOfWeek: 2,
    name: 'Cooldown',
    workoutKey: 'cooldown',
    partIndex: 3,
    partCount: 3,
    expectedDistanceM: 1500,
    distanceToleranceM: 250,
    steps: [],
  },
];

describe('activity part matcher', () => {
  it('matches same-day activities one-to-one using distance and order', () => {
    const matches = matchActivityParts([
      {
        id: 'warmup-run',
        start_time: '2026-08-11T17:00:00Z',
        distance: 2050,
        activity_name: 'Warmup',
      },
      {
        id: 'test-run',
        start_time: '2026-08-11T17:20:00Z',
        distance: 3012,
        activity_name: '3000 TEST',
      },
      {
        id: 'cooldown-run',
        start_time: '2026-08-11T17:40:00Z',
        distance: 1480,
        activity_name: 'Evening Run',
      },
    ], parts);

    expect(matches.map((match) => [match.activityId, match.workoutKey])).toEqual([
      ['warmup-run', 'warmup'],
      ['test-run', 'test'],
      ['cooldown-run', 'cooldown'],
    ]);
  });

  it('does not force a very different distance into the test part', () => {
    const matches = matchActivityParts([
      {
        id: 'long-run',
        start_time: '2026-08-11T17:20:00Z',
        distance: 10000,
        activity_name: 'Tuesday long run',
      },
    ], parts);
    expect(matches).toEqual([]);
  });
});
