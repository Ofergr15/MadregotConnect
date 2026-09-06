import { describe, expect, it } from 'vitest';
import { pairByGarminWorkoutId } from '@/lib/plans/garmin-workout-matches';

const delivery = (id: string, garminWorkoutId: string | null, workoutKey: string | null) => ({
  id,
  garmin_workout_id: garminWorkoutId,
  workout_key: workoutKey,
});

const activity = (id: string, garminWorkoutId?: string | null) => ({
  id,
  garmin_workout_id: garminWorkoutId,
});

describe('pairByGarminWorkoutId', () => {
  it('pairs an activity to the plan part it was started from', () => {
    const matches = pairByGarminWorkoutId(
      [activity('act-1', '111'), activity('act-2', '222')],
      [
        delivery('del-1', '111', 'day-2-part-0-intervals'),
        delivery('del-2', '222', 'day-4-part-0-long'),
      ],
    );
    expect(matches).toEqual([
      {
        activityId: 'act-1',
        workoutKey: 'day-2-part-0-intervals',
        deliveryId: 'del-1',
        garminWorkoutId: '111',
      },
      {
        activityId: 'act-2',
        workoutKey: 'day-4-part-0-long',
        deliveryId: 'del-2',
        garminWorkoutId: '222',
      },
    ]);
  });

  // The common case, and the reason the heuristic still has to exist: most club
  // runs are just someone pressing start.
  it('ignores activities that carry no workout id', () => {
    const matches = pairByGarminWorkoutId(
      [activity('free-run'), activity('other', null), activity('act-1', '111')],
      [delivery('del-1', '111', 'day-2-part-0-intervals')],
    );
    expect(matches.map((match) => match.activityId)).toEqual(['act-1']);
  });

  it('ignores an activity whose workout id was never pushed for this plan', () => {
    const matches = pairByGarminWorkoutId(
      [activity('act-1', '999')],
      [delivery('del-1', '111', 'day-2-part-0-intervals')],
    );
    expect(matches).toEqual([]);
  });

  // A scheduled workout stays on the calendar, so an athlete who runs it twice
  // stamps both activities. One plan slot is one session: the first takes it and
  // the second is left for the heuristic to place elsewhere or nowhere.
  it('gives a repeated workout to the first activity only', () => {
    const matches = pairByGarminWorkoutId(
      [activity('first', '111'), activity('second', '111')],
      [delivery('del-1', '111', 'day-2-part-0-intervals')],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].activityId).toBe('first');
  });

  // Shouldn't happen — Garmin issues a fresh id per create — but a re-push whose
  // cleanup failed can leave an old row behind, and two rows claiming the same id
  // must not produce two matches for one activity.
  it('resolves duplicate deliveries to a single match', () => {
    const matches = pairByGarminWorkoutId(
      [activity('act-1', '111')],
      [
        delivery('del-old', '111', 'day-2-part-0-intervals'),
        delivery('del-new', '111', 'day-3-part-0-easy'),
      ],
    );
    expect(matches).toEqual([
      {
        activityId: 'act-1',
        workoutKey: 'day-2-part-0-intervals',
        deliveryId: 'del-old',
        garminWorkoutId: '111',
      },
    ]);
  });

  // Not usable evidence, and guessing from them is exactly what this replaces:
  // a failed push has no id, and a delivery recorded before migration 092 has no
  // key to point at.
  it('skips deliveries with no workout id or no workout key', () => {
    const matches = pairByGarminWorkoutId(
      [activity('act-1', '111'), activity('act-2', '222'), activity('act-3', '')],
      [
        delivery('del-1', null, 'day-2-part-0-intervals'),
        delivery('del-2', '', 'day-3-part-0-easy'),
        delivery('del-3', '222', null),
      ],
    );
    expect(matches).toEqual([]);
  });

  it('is empty when there is nothing to pair', () => {
    expect(pairByGarminWorkoutId([], [delivery('del-1', '111', 'day-2-part-0-intervals')])).toEqual([]);
    expect(pairByGarminWorkoutId([activity('act-1', '111')], [])).toEqual([]);
  });

  // Postgres text columns keep whatever was written; the ids come from two
  // different Garmin responses, so neither side is trusted to be tidy.
  it('matches ids that differ only by surrounding whitespace', () => {
    const matches = pairByGarminWorkoutId(
      [activity('act-1', ' 111 ')],
      [delivery('del-1', '111\n', 'day-2-part-0-intervals')],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].garminWorkoutId).toBe('111');
  });
});
