import { describe, expect, it } from 'vitest';
import { dateOffsetStr, minutesToHHMM, roundToStep, describeNotificationRow, SCHEDULE_STEP_MIN } from '@/lib/notifications/scheduling';

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
  it('rounds down when closer to the previous 5-minute mark', () => {
    expect(roundToStep('09:02')).toBe('09:00');
  });

  it('rounds up when closer to the next 5-minute mark', () => {
    expect(roundToStep('09:03')).toBe('09:05');
  });

  it('leaves an already-on-grid time unchanged', () => {
    expect(roundToStep('09:05')).toBe('09:05');
  });

  it('rounding up across an hour boundary carries correctly', () => {
    expect(roundToStep('09:58')).toBe('10:00');
  });

  it('rounding up across midnight wraps to 00:00', () => {
    expect(roundToStep('23:58')).toBe('00:00');
  });

  it('SCHEDULE_STEP_MIN is exported and matches the actual delivery grid used above (5 min)', () => {
    expect(SCHEDULE_STEP_MIN).toBe(5);
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
    expect(result.iconBg).toBe('bg-green-500');
  });

  it('a cancelled notification shows "בוטל" and a slate icon, regardless of schedule_type', () => {
    const result = describeNotificationRow({ ...base, status: 'cancelled', schedule_type: 'recurring', recur_interval: 2, recur_unit: 'week' });
    expect(result.statusText).toBe('בוטל');
    expect(result.iconKind).toBe('cancelled');
  });

  it('a recurring, not-yet-sent notification shows the interval in weeks', () => {
    const result = describeNotificationRow({ ...base, schedule_type: 'recurring', recur_interval: 2, recur_unit: 'week' });
    expect(result.statusText).toBe('כל 2 שבועות');
    expect(result.iconKind).toBe('recurring');
  });

  it('a recurring notification with recur_unit "day" shows ימים, not שבועות', () => {
    const result = describeNotificationRow({ ...base, schedule_type: 'recurring', recur_interval: 3, recur_unit: 'day' });
    expect(result.statusText).toBe('כל 3 ימים');
  });

  it('a one-off scheduled notification with a next_run_at shows the formatted date', () => {
    const result = describeNotificationRow({ ...base, next_run_at: '2026-03-01T10:00:00.000Z' });
    expect(result.statusText).not.toBe('מתוזמן'); // real date, not the generic fallback
    expect(result.iconKind).toBe('scheduled');
    expect(result.iconBg).toBe('bg-amber-500');
  });

  it('a one-off scheduled notification with no next_run_at yet falls back to a generic label', () => {
    const result = describeNotificationRow({ ...base, next_run_at: null });
    expect(result.statusText).toBe('מתוזמן');
  });

  it('maps audience_type to Hebrew text', () => {
    expect(describeNotificationRow({ ...base, audience_type: 'all' }).audienceText).toBe('הכל');
    expect(describeNotificationRow({ ...base, audience_type: 'group' }).audienceText).toBe('קבוצה');
    expect(describeNotificationRow({ ...base, audience_type: 'athlete' }).audienceText).toBe('אדם');
  });
});
