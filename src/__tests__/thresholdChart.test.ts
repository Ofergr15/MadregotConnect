import { describe, expect, it } from 'vitest';
import { monthLabelAt, thresholdChart } from '@/lib/charts/threshold';

/** 7ג: the mockup's four tests (4:38 → 4:12) — oldest left, faster higher. */
const TESTS = [
  { date: '2026-03-15', paceSec: 278 }, { date: '2026-05-15', paceSec: 270 },
  { date: '2026-07-15', paceSec: 261 }, { date: '2026-09-16', paceSec: 252 },
];

describe('thresholdChart', () => {
  const c = thresholdChart(TESTS)!;
  it('runs left to right in time, and an improving threshold climbs', () => {
    const xs = c.points.map(p => p.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    const ys = c.points.map(p => p.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
    expect(c.points[3].newest).toBe(true);
    expect(c.area).toMatch(/Z$/);
  });
  it('one test is a dot; none is nothing', () => {
    expect(thresholdChart([TESTS[0]])!.points).toHaveLength(1);
    expect(thresholdChart([])).toBeNull();
  });
  it('months under every point of a short history, thinned on a long one', () => {
    expect([0, 1, 2, 3].every(i => monthLabelAt(i, 4))).toBe(true);
    expect(Array.from({ length: 9 }, (_, i) => monthLabelAt(i, 9))).toEqual([true, false, true, false, true, false, true, false, true]);
  });
});
