import { describe, expect, it } from 'vitest';
import { FIRST_HOUR, LAST_HOUR, isWithinSyncWindow } from '@/app/api/cron/sync/route';

// The live skip branch is only observable before 05:00 or after 23:00 Israel, and
// Vercel keeps no historical logs — so the boundaries are pinned here instead.
describe('cron sync window', () => {
  it('covers the intended Israeli waking hours', () => {
    expect([FIRST_HOUR, LAST_HOUR]).toEqual([5, 23]);
  });

  it('opens at 05:00 and not before', () => {
    expect(isWithinSyncWindow(4)).toBe(false);
    expect(isWithinSyncWindow(5)).toBe(true);
  });

  it('closes at 23:00, so the last pass is 22:55', () => {
    expect(isWithinSyncWindow(22)).toBe(true);
    expect(isWithinSyncWindow(23)).toBe(false);
  });

  it('skips the whole night', () => {
    for (const hour of [0, 1, 2, 3, 4, 23]) {
      expect(isWithinSyncWindow(hour)).toBe(false);
    }
  });

  it('runs every hour in between', () => {
    for (let hour = 5; hour < 23; hour++) {
      expect(isWithinSyncWindow(hour)).toBe(true);
    }
  });
});
