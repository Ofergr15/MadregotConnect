import { describe, expect, it } from 'vitest';
import {
  assertWorkoutOnAccount,
  readCreatedWorkoutId,
  readScheduleConfirmation,
} from '@/lib/garmin/delivery';

// The regression net for "was this workout actually delivered?".
//
// Before this existed, a push was reported delivered whenever the two Garmin
// POSTs failed to throw: `createWorkout` turned a response with no workoutId
// into the empty string, `scheduleWorkout('')` POSTed to a URL with no id, and
// the athlete got a "new workouts on your watch" notification for a workout
// that was never created. Every case below is a shape that used to pass.

describe('readCreatedWorkoutId', () => {
  it('returns the id Garmin issued, as a string', () => {
    expect(readCreatedWorkoutId({ workoutId: 1234567890 })).toBe('1234567890');
    expect(readCreatedWorkoutId({ workoutId: '1234567890' })).toBe('1234567890');
  });

  it('throws instead of returning a placeholder id', () => {
    // The whole original bug: each of these used to become '' and be recorded
    // as a successful delivery.
    for (const response of [
      {},
      null,
      undefined,
      { workoutId: null },
      { workoutId: undefined },
      { workoutId: '' },
      { workoutId: 0 },
      { workoutId: '0' },
      { workoutId: false },
      { error: 'quota exceeded' },
    ]) {
      expect(() => readCreatedWorkoutId(response)).toThrow(/no workout id/i);
    }
  });

  it('names what Garmin sent back, so the coach sees why', () => {
    expect(() => readCreatedWorkoutId({ error: 'quota exceeded' }))
      .toThrow(/quota exceeded/);
  });
});

describe('readScheduleConfirmation', () => {
  it('reads the schedule id and date Garmin confirms', () => {
    expect(readScheduleConfirmation(
      { workoutScheduleId: 987654, calendarDate: '2026-09-08' },
      '2026-09-08',
    )).toEqual({ scheduleId: '987654', calendarDate: '2026-09-08' });
  });

  it('accepts a date carrying a time component', () => {
    // Garmin has returned both `2026-09-08` and `2026-09-08T00:00:00.0`.
    expect(readScheduleConfirmation(
      { calendarDate: '2026-09-08T00:00:00.0' },
      '2026-09-08',
    ).calendarDate).toBe('2026-09-08');
  });

  it('reads a nested workoutSchedule', () => {
    expect(readScheduleConfirmation(
      { workoutSchedule: { workoutScheduleId: 42, calendarDate: '2026-09-08' } },
      '2026-09-08',
    )).toEqual({ scheduleId: '42', calendarDate: '2026-09-08' });
  });

  it('throws when Garmin scheduled a different day than we asked for', () => {
    // Worse than not delivering: the athlete finds the session on the wrong day
    // and trains it there.
    expect(() => readScheduleConfirmation({ calendarDate: '2026-09-09' }, '2026-09-08'))
      .toThrow(/2026-09-09 instead of 2026-09-08/);
  });

  it('reports "unconfirmed" rather than failing on an opaque 200', () => {
    // The schedule endpoint is undocumented. A body we can't read means we can't
    // confirm the date — not that the schedule is wrong — and hard-failing here
    // would break every push the day Garmin changes the response shape. The
    // workout read-back is what actually proves delivery.
    for (const response of [{}, null, undefined, '', 'OK', { status: 'ok' }]) {
      expect(readScheduleConfirmation(response, '2026-09-08'))
        .toEqual({ scheduleId: null, calendarDate: null });
    }
  });
});

describe('assertWorkoutOnAccount', () => {
  it('passes when the workout reads back', () => {
    expect(() => assertWorkoutOnAccount({ workoutId: 1234567890 }, '1234567890')).not.toThrow();
  });

  it('throws when Garmin has no such workout', () => {
    for (const detail of [null, undefined, {}, { workoutId: null }, { workoutId: '' }]) {
      expect(() => assertWorkoutOnAccount(detail, '1234567890')).toThrow(/did not stick/);
    }
  });

  it('throws when a different workout comes back', () => {
    expect(() => assertWorkoutOnAccount({ workoutId: 999 }, '1234567890'))
      .toThrow(/999 when asking for 1234567890/);
  });
});
