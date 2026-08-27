import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { getPlanWeekStart, getActivityWeekStart, toISODate } from '@/lib/utils';

// Regression coverage for a real bug: these helpers used to serialize via
// `d.toISOString().split('T')[0]`, which re-expresses the local Sunday in UTC
// first — silently rolling it back to Saturday for ~2-3 hours right after
// local midnight in a positive-UTC-offset timezone like Israel (IDT, UTC+3).
describe('getPlanWeekStart / getActivityWeekStart (Asia/Jerusalem)', () => {
  const originalTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = originalTZ; });

  it('returns the correct Sunday just after local midnight, not the previous day', () => {
    // 2026-08-23 is a Sunday; 00:30 IDT local time.
    const justAfterMidnight = new Date('2026-08-23T00:30:00+03:00');
    expect(getPlanWeekStart(justAfterMidnight)).toBe('2026-08-23');
    expect(getActivityWeekStart(justAfterMidnight)).toBe('2026-08-23');
  });

  it('returns the same Sunday later the same day', () => {
    const afternoon = new Date('2026-08-23T14:00:00+03:00');
    expect(getPlanWeekStart(afternoon)).toBe('2026-08-23');
  });

  it('returns the prior Sunday for a mid-week date', () => {
    const wednesday = new Date('2026-08-26T10:00:00+03:00');
    expect(getPlanWeekStart(wednesday)).toBe('2026-08-23');
  });
});

describe('toISODate', () => {
  it('formats using local calendar fields, not a UTC-shifted one', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Jerusalem';
    expect(toISODate(new Date('2026-08-23T00:30:00+03:00'))).toBe('2026-08-23');
    process.env.TZ = originalTZ;
  });
});
