import { describe, expect, it } from 'vitest';
import { resendWarning, sentDaysFrom } from '@/lib/plans/resend-warning';

const rows = [
  { workout_date: '2026-10-11', athlete_id: 'a', created_at: '2026-10-10T20:20:59Z' },
  { workout_date: '2026-10-11', athlete_id: 'b', created_at: '2026-10-10T20:21:10Z' },
  { workout_date: '2026-10-11', athlete_id: 'a', created_at: '2026-10-10T20:40:56Z' },
];

describe('resendWarning', () => {
  it('Saturday 23:43 Israel, re-sending Sunday: warns, 2 athletes, last at 20:40Z, ~3h to go', () => {
    const w = resendWarning(['2026-10-11'], sentDaysFrom(rows), new Date('2026-10-10T20:43:00Z'));
    expect(w).toMatchObject({ dates: ['2026-10-11'], athletes: 2, lastSentAt: '2026-10-10T20:40:56.000Z' });
    expect(w!.hoursToSession).toBeGreaterThanOrEqual(5);
    expect(w!.hoursToSession).toBeLessThanOrEqual(6);
  });
  it('the same re-send on Wednesday: no warning (plenty of time to sync)', () => {
    expect(resendWarning(['2026-10-11'], sentDaysFrom(rows), new Date('2026-10-07T10:00:00Z'))).toBeNull();
  });
  it('a first send: no warning', () => {
    expect(resendWarning(['2026-10-12'], sentDaysFrom(rows), new Date('2026-10-11T20:00:00Z'))).toBeNull();
  });
});
