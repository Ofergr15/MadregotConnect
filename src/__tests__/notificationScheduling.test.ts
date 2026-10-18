import { describe, expect, it } from 'vitest';
import { dateOffsetStr, minutesToHHMM, roundToStep, describeNotificationRow, isPastSchedule, nextRecurrence, SCHEDULE_STEP_MIN } from '@/lib/notifications/scheduling';

describe('minutesToHHMM', () => {
  it('formats simple times with zero-padding', () => {
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(65)).toBe('01:05');
    expect(minutesToHHMM(9 * 60)).toBe('09:00');
  });

  it('wraps past midnight (>= 1440 minutes)', () => {
    expect(minutesToHHMM(1440)).toBe('00:00');
    expect(minutesToHHMM(1440 + 30)).toBe('00:30');
  });

  it('wraps negative minutes backward into the previous day, not into an invalid time', () => {
    expect(minutesToHHMM(-30)).toBe('23:30');
    expect(minutesToHHMM(-1440)).toBe('00:00');
  });
});

describe('roundToStep', () => {
  it('keeps any minute: the scanner runs every minute', () => {
    expect(SCHEDULE_STEP_MIN).toBe(1);
    expect(roundToStep('09:02')).toBe('09:02');
    expect(roundToStep('23:59')).toBe('23:59');
  });
});

describe('nextRecurrence', () => {
  const at = (iso: string) => Date.parse(iso);
  it('keeps the Israeli wall-clock time across the October clock change', () => {
    // Tue 20.10.2026 08:00 IDT (05:00Z) weekly -> Tue 27.10 08:00 IST (06:00Z), not 07:00.
    expect(nextRecurrence('2026-10-20T05:00:00.000Z', 1, 'week', at('2026-10-20T05:00:30Z'))).toBe('2026-10-27T06:00:00.000Z');
  });
  it('and across the March one', () => {
    // Israel moves to summer time on Friday 26.3.2027. Thu 25.3 07:00 IST (05:00Z) daily
    // -> Fri 26.3 07:00 IDT (04:00Z).
    expect(nextRecurrence('2027-03-25T05:00:00.000Z', 1, 'day', at('2027-03-25T05:00:30Z'))).toBe('2027-03-26T04:00:00.000Z');
  });
  it('skips every run it missed instead of sending each one', () => {
    // Daily 08:00 last run a week ago -> the next 08:00 still ahead, once.
    expect(nextRecurrence('2026-10-01T05:00:00.000Z', 1, 'day', at('2026-10-08T06:00:00Z'))).toBe('2026-10-09T05:00:00.000Z');
  });
  it('steps whole weeks', () => {
    expect(nextRecurrence('2026-09-01T05:00:00.000Z', 2, 'week', at('2026-09-01T05:01:00Z'))).toBe('2026-09-15T05:00:00.000Z');
  });
});

describe('isPastSchedule', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  it('allows a minute of grace and refuses anything older', () => {
    expect(isPastSchedule('2026-10-18T09:59:30Z', now)).toBe(false);
    expect(isPastSchedule('2026-10-18T09:58:00Z', now)).toBe(true);
    expect(isPastSchedule('2026-10-18T11:00:00Z', now)).toBe(false);
    expect(isPastSchedule(null, now)).toBe(false);
  });
});

describe('dateOffsetStr', () => {
  it('offset 0 returns a valid YYYY-MM-DD for today', () => {
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(dateOffsetStr(0)).toBe(expected);
  });

  it('is monotonically increasing (lexicographically) as the offset grows, across a month/year boundary', () => {
    const d0 = dateOffsetStr(0);
    const d40 = dateOffsetStr(40); // guarantees crossing at least one month boundary
    expect(d40 > d0).toBe(true);
  });

  it('handles a negative offset (past date) without throwing', () => {
    expect(() => dateOffsetStr(-1)).not.toThrow();
    expect(dateOffsetStr(-1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('describeNotificationRow', () => {
  const base = {
    status: 'scheduled', schedule_type: 'once', sent_count: 0,
    recur_interval: null, recur_unit: null, next_run_at: null, audience_type: 'all',
  };

  it('a sent notification shows the send count and a green check icon', () => {
    const result = describeNotificationRow({ ...base, status: 'sent', sent_count: 3 });
    expect(result.statusText).toBe('נשלח (3)');
    expect(result.iconKind).toBe('sent');
    expect(result.iconBg).toBe('bg-accent-600');
  });

  it('a cancelled notification shows "בוטל" and a grey icon, regardless of schedule_type', () => {
    const result = describeNotificationRow({ ...base, status: 'cancelled', schedule_type: 'recurring', recur_interval: 2, recur_unit: 'week' });
    expect(result.statusText).toBe('בוטל');
    expect(result.iconKind).toBe('cancelled');
  });

  it('a recurring, not-yet-sent notification shows the interval in weeks', () => {
    const result = describeNotificationRow({ ...base, schedule_type: 'recurring', recur_interval: 2, recur_unit: 'week' });
    expect(result.statusText).toBe('כל שבועיים');
    expect(result.iconKind).toBe('recurring');
  });

  it('a recurring notification with recur_unit "day" shows ימים, not שבועות', () => {
    const result = describeNotificationRow({ ...base, schedule_type: 'recurring', recur_interval: 3, recur_unit: 'day' });
    expect(result.statusText).toBe('כל 3 ימים');
    expect(describeNotificationRow({ ...base, schedule_type: 'recurring', recur_interval: 1, recur_unit: 'week' }).statusText).toBe('כל שבוע');
    expect(describeNotificationRow({ ...base, schedule_type: 'recurring', recur_interval: 1, recur_unit: 'day' }).statusText).toBe('כל יום');
  });

  it('a one-off scheduled notification with a next_run_at shows the formatted date', () => {
    const result = describeNotificationRow({ ...base, next_run_at: '2026-03-01T10:00:00.000Z' });
    expect(result.statusText).not.toBe('מתוזמן'); // real date, not the generic fallback
    expect(result.iconKind).toBe('scheduled');
    expect(result.iconBg).toBe('bg-band-3');
  });

  it('a one-off scheduled notification with no next_run_at yet falls back to a generic label', () => {
    const result = describeNotificationRow({ ...base, next_run_at: null });
    expect(result.statusText).toBe('מתוזמן');
  });

  it('maps audience_type to Hebrew text', () => {
    expect(describeNotificationRow({ ...base, audience_type: 'all' }).audienceText).toBe('הכל');
    expect(describeNotificationRow({ ...base, audience_type: 'group' }).audienceText).toBe('קבוצה');
    expect(describeNotificationRow({ ...base, audience_type: 'athlete' }).audienceText).toBe('אדם');
    expect(describeNotificationRow({ ...base, audience_type: 'academy' }).audienceText).toBe('אקדמיה');
  });
});
