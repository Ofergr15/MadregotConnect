import { describe, expect, it } from 'vitest';
import { previousCompletedMonthRange } from '@/lib/badges/award-engine';

describe('previousCompletedMonthRange', () => {
  it('resolves to the prior month when "now" is mid-month', () => {
    // 2026-08-21 12:00 UTC is well inside the Israel-local day (UTC+3), so
    // this doesn't straddle a day boundary either.
    const now = new Date('2026-08-21T12:00:00Z');
    const range = previousCompletedMonthRange(now);
    expect(range.firstDayStr).toBe('2026-07-01');
    expect(range.lastDayStr).toBe('2026-07-31');
    expect(range.nextMonthFirstStr).toBe('2026-08-01');
    expect(range.lastDayNum).toBe(31);
  });

  it('rolls back across a year boundary in January', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const range = previousCompletedMonthRange(now);
    expect(range.firstDayStr).toBe('2025-12-01');
    expect(range.lastDayStr).toBe('2025-12-31');
    expect(range.nextMonthFirstStr).toBe('2026-01-01');
  });

  it('handles a short (28-day) February correctly', () => {
    const now = new Date('2026-03-05T12:00:00Z');
    const range = previousCompletedMonthRange(now);
    expect(range.firstDayStr).toBe('2026-02-01');
    expect(range.lastDayStr).toBe('2026-02-28');
    expect(range.lastDayNum).toBe(28);
  });
});
