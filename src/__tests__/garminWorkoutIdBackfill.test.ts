import { describe, it, expect } from 'vitest';
import { pairListWorkoutIds } from '@/lib/garmin/workout-id-backfill';

const row = (garmin_activity_id: number, overrides: Partial<{ id: string; athlete_id: string; start_time: string }> = {}) => ({
  id: `row-${garmin_activity_id}`,
  garmin_activity_id,
  athlete_id: 'athlete-1',
  start_time: '2026-09-06T05:34:49+00:00',
  ...overrides,
});

const list = (entries: Array<[number, string | null]>) =>
  new Map(entries.map(([id, workoutId]) => [id, { workoutId }]));

describe('pairListWorkoutIds', () => {
  it('fills the workout id the activity list carries', () => {
    const filled = pairListWorkoutIds([row(24253890790)], list([[24253890790, '1687915430']]));
    expect(filled).toEqual([
      {
        activityRowId: 'row-24253890790',
        garminActivityId: 24253890790,
        athleteId: 'athlete-1',
        startTime: '2026-09-06T05:34:49+00:00',
        garminWorkoutId: '1687915430',
      },
    ]);
  });

  // A free run has no workout behind it: NULL is the right answer, not a retry.
  it('leaves a run that was not started from a workout alone', () => {
    expect(pairListWorkoutIds([row(1)], list([[1, null]]))).toEqual([]);
  });

  // Outside the pages the list returned — a Strava-era row, or a deleted activity.
  it('skips a row Garmin never listed', () => {
    expect(pairListWorkoutIds([row(1)], list([[2, '99']]))).toEqual([]);
  });

  it('fills only the rows with an id, in the order given', () => {
    const filled = pairListWorkoutIds(
      [row(1), row(2), row(3)],
      list([[1, '10'], [2, null], [3, '30']]),
    );
    expect(filled.map(f => [f.garminActivityId, f.garminWorkoutId])).toEqual([[1, '10'], [3, '30']]);
  });

  it('keeps each row with its own athlete', () => {
    const filled = pairListWorkoutIds(
      [row(1), row(2, { athlete_id: 'athlete-2' })],
      list([[1, '10'], [2, '20']]),
    );
    expect(filled.map(f => f.athleteId)).toEqual(['athlete-1', 'athlete-2']);
  });

  it('is a no-op on an empty list', () => {
    expect(pairListWorkoutIds([row(1)], new Map())).toEqual([]);
    expect(pairListWorkoutIds([], list([[1, '10']]))).toEqual([]);
  });
});
