import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { israelToday } from '@/lib/utils';

// QA 11-19 (Instinct): "ביטול ההעברה" compared the UTC date prefix of accepted_at with Israel's
// today, so between 00:00 and 02:00 Israel time the card did not return to the funnel.
afterEach(() => vi.useRealTimers());

describe('undo move-in: Israel day of the stored timestamp', () => {
  it('a card accepted at 00:30 Israel (22:30 UTC the day before) is "today" in Israel', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T22:40:00Z')); // 19.11 00:40 Israel
    const acceptedAt = '2026-11-18T22:30:00Z';           // 19.11 00:30 Israel
    expect(acceptedAt.slice(0, 10)).not.toBe(israelToday()); // the old comparison: fails
    expect(israelToday(new Date(acceptedAt))).toBe(israelToday()); // the new one: matches
  });
  it('still matches in the evening (the case that always worked)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T21:30:00Z')); // 18.11 23:30 Israel
    expect(israelToday(new Date('2026-11-18T21:00:00Z'))).toBe(israelToday());
  });
  it('manage-server no longer slices UTC prefixes for the undo', () => {
    const s = readFileSync('src/lib/academy/manage-server.ts', 'utf8');
    expect(s).toContain('israelDayOf(c.created_at) === today');
    expect(s).toContain('israelDayOf(c.accepted_at) === today');
    expect(s).not.toMatch(/String\(c\.(created_at|accepted_at) \|\| ''\)\.slice\(0, 10\) === today/);
  });
});
