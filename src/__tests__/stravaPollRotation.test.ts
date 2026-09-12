import { describe, it, expect } from 'vitest';
import {
  STRAVA_POLL_BUDGET,
  STRAVA_POLL_TICK_MS,
  stravaPollSlice,
  stravaPollTick,
} from '@/lib/strava/poll-rotation';

/**
 * The Strava fallback poll's rationing.
 *
 * Worth pinning because both failure modes are invisible in production: a slice
 * that always returns the same athletes starves the rest (their runs go on
 * arriving hours late, exactly the bug this fixes, and the cron log still says
 * polled:2), and a slice that grows with the club quietly overruns a shared
 * 1,000-a-day API quota that fails somewhere else entirely.
 */
describe('stravaPollSlice', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('never polls more athletes than the budget', () => {
    for (let tick = 0; tick < 20; tick++) {
      expect(stravaPollSlice(ids, tick, 2)).toHaveLength(2);
    }
  });

  it('advances to the next athletes on the next tick', () => {
    expect(stravaPollSlice(ids, 0, 2)).toEqual(['a', 'b']);
    expect(stravaPollSlice(ids, 1, 2)).toEqual(['c', 'd']);
  });

  // Where a naive `slice(start, start + budget)` returns one athlete instead of
  // two, permanently under-polling whoever sits at the end of the list.
  it('wraps around the end of the list', () => {
    expect(stravaPollSlice(ids, 2, 2)).toEqual(['e', 'a']);
  });

  // The property that matters more than any single tick's answer: over the ticks
  // it takes to get round the list, everybody is polled. This is what "your run
  // shows up within ten minutes" actually rests on.
  it('reaches every athlete within ceil(n / budget) ticks, from any starting tick', () => {
    for (let start = 0; start < 12; start++) {
      const seen = new Set<string>();
      for (let tick = start; tick < start + Math.ceil(ids.length / 2); tick++) {
        for (const id of stravaPollSlice(ids, tick, 2)) seen.add(id);
      }
      expect([...seen].sort()).toEqual(ids);
    }
  });

  it('polls everyone at once when the budget is not the constraint', () => {
    expect(stravaPollSlice(['a', 'b'], 7, 4)).toEqual(['a', 'b']);
  });

  it('has nothing to do when nobody is Strava-only', () => {
    expect(stravaPollSlice([], 3, 2)).toEqual([]);
  });

  // A budget of zero is how the poll would be switched off; it must be off, not
  // accidentally unlimited.
  it('polls nobody on a zero budget', () => {
    expect(stravaPollSlice(ids, 3, 0)).toEqual([]);
  });

  it('keeps the cost flat as the club grows', () => {
    const big = Array.from({ length: 60 }, (_, i) => `athlete-${i}`);
    expect(stravaPollSlice(big, 5)).toHaveLength(STRAVA_POLL_BUDGET);
  });
});

describe('stravaPollTick', () => {
  it('holds still inside one cron period and moves on to the next', () => {
    // The start of a tick, not an arbitrary instant: mid-period, "one tick minus
    // a millisecond later" legitimately lands in the next period.
    const base = Math.ceil(1_700_000_000_000 / STRAVA_POLL_TICK_MS) * STRAVA_POLL_TICK_MS;
    expect(stravaPollTick(base)).toBe(stravaPollTick(base + STRAVA_POLL_TICK_MS - 1));
    expect(stravaPollTick(base + STRAVA_POLL_TICK_MS)).toBe(stravaPollTick(base) + 1);
  });
});
