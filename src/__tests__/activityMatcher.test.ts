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

  it('claims a session run a day late, recording the shift', () => {
    // 2026-08-12 is the Wednesday after the planned Tuesday.
    const matches = matchActivityParts([
      { id: 'late-test', start_time: '2026-08-12T17:20:00Z', distance: 3010, activity_name: '3000 TEST' },
    ], parts);
    expect(matches.map((match) => match.workoutKey)).toEqual(['test']);
    expect(matches[0].evidence.dayDelta).toBe(1);
  });

  it('prefers the activity on the planned day over one a day away', () => {
    const matches = matchActivityParts([
      { id: 'on-day', start_time: '2026-08-11T17:20:00Z', distance: 3010, activity_name: 'Evening Run' },
      { id: 'day-after', start_time: '2026-08-12T17:20:00Z', distance: 3005, activity_name: 'Evening Run' },
    ], [parts[1]]);
    expect(matches.map((match) => match.activityId)).toEqual(['on-day']);
  });

  it('ignores an activity two days from the planned day', () => {
    const matches = matchActivityParts([
      { id: 'much-later', start_time: '2026-08-13T17:20:00Z', distance: 3010, activity_name: '3000 TEST' },
    ], parts);
    expect(matches).toEqual([]);
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

// Ofer, 2026-10-21: an extra run on a day whose plan was run goes against that day's extra
// sessions only, or nowhere; and of a day's runs, the session takes the one that fits it.
describe('extra runs and the run that fits', () => {
  const at = (day: number, hh: number) => `2026-10-${String(18 + day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:00:00+00:00`;
  const run = (id: string, day: number, hh: number, km: number, extra: Partial<{ workout_title: string }> = {}) => ({ id, start_time: at(day, hh), distance: km * 1000, activity_name: 'Run', ...extra });
  const session = (key: string, day: number, km: number, more: Partial<ParsedWorkout> = {}): ParsedWorkout => ({
    dayOfWeek: day, name: key, workoutKey: key, partIndex: 1, partCount: 1, expectedDistanceM: km * 1000, steps: [], ...more,
  });
  const mondayEvening = session('mon-evening', 1, 7, { partIndex: 2, partCount: 2, optional: true });

  it('the evening run after the quality day does not take yesterday\'s session', () => {
    // Tuesday's 10 × 1600 was matched by the watch (so Tuesday is done); 3.5 km cool-down, 7.3 km evening.
    const m = matchActivityParts([run('cool', 2, 7, 3.5), run('evening', 2, 19, 7.3)], [mondayEvening], 45, { doneDays: [2] });
    expect(m).toEqual([]);
  });
  it('but meets an evening session planned for that same day', () => {
    const tueEvening = session('tue-evening', 2, 7, { partIndex: 2, partCount: 2 });
    const m = matchActivityParts([run('evening', 2, 19, 7.3)], [mondayEvening, tueEvening], 45, { doneDays: [2] });
    expect(m.map((x) => [x.activityId, x.workoutKey])).toEqual([['evening', 'tue-evening']]);
  });
  it('a workout moved to the next day still counts when that day had nothing done', () => {
    const m = matchActivityParts([run('wed', 3, 6, 12)], [session('tue-intervals', 2, 12)]);
    expect(m.map((x) => x.workoutKey)).toEqual(['tue-intervals']);
  });
  it('easy, the workout, easy — the session takes the workout, not the first run', () => {
    const quality = session('tue-quality', 2, 14, { name: 'אינטרוולים 6 × 1000' });
    const m = matchActivityParts([run('easy1', 2, 5, 3), run('main', 2, 6, 13.5, { workout_title: '6 × 1000' }), run('easy2', 2, 8, 3)], [quality]);
    expect(m.map((x) => x.activityId)).toEqual(['main']);
  });
  it('a watch workout is not an easy session\'s run when another run fits it', () => {
    const easy = session('tue-easy', 2, 8, { name: 'שחרור' });
    const m = matchActivityParts([run('intervals', 2, 6, 8.5, { workout_title: '8 × 400' }), run('jog', 2, 18, 7.8)], [easy]);
    expect(m.map((x) => x.activityId)).toEqual(['jog']);
  });
});
