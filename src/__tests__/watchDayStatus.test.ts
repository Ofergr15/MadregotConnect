import { describe, expect, it } from 'vitest';
import { israelClock, watchDayState, watchDays } from '@/lib/watch/day-status';

describe('watchDays — what we know about each day on the watch', () => {
  it('one push = sent, not updated', () => {
    const d = watchDays([{ workout_date: '2026-10-08', created_at: '2026-10-03T16:43:06Z' }]);
    expect(watchDayState(d['2026-10-08'])).toBe('sent');
    expect(d['2026-10-08'].updatedAt).toBeNull();
  });

  it('a double day from one push is still one send', () => {
    const d = watchDays([
      { workout_date: '2026-10-05', created_at: '2026-10-03T16:43:01Z' },
      { workout_date: '2026-10-05', created_at: '2026-10-03T16:43:02Z' },
    ]);
    expect(watchDayState(d['2026-10-05'])).toBe('sent');
  });

  it("Eyal's Sunday: three sends in 23 minutes = updated, at the last one", () => {
    const d = watchDays([
      { workout_date: '2026-10-11', created_at: '2026-10-10T20:20:59Z' },
      { workout_date: '2026-10-11', created_at: '2026-10-10T20:40:56Z' },
      { workout_date: '2026-10-11', created_at: '2026-10-10T20:43:08Z' },
    ]);
    expect(watchDayState(d['2026-10-11'])).toBe('updated');
    expect(d['2026-10-11'].updatedAt).toBe('2026-10-10T20:43:08.000Z');
    expect(israelClock(d['2026-10-11'].updatedAt!)).toBe('23:43');
  });

  it('a run stamped with the workout wins over everything', () => {
    const d = watchDays([
      { workout_date: '2026-10-06', created_at: '2026-10-03T16:43:03Z', device_confirmed_at: '2026-10-06T04:22:23Z' },
      { workout_date: '2026-10-06', created_at: '2026-10-05T19:00:00Z' },
    ]);
    expect(watchDayState(d['2026-10-06'])).toBe('ran');
  });

  it('no row = none', () => {
    expect(watchDayState(watchDays([])['2026-10-12'])).toBe('none');
  });
});
