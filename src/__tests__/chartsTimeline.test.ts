import { describe, expect, it } from 'vitest';
import { smoothPath, xAt } from '@/lib/charts/timeline';

/** G1: time runs LEFT → RIGHT, oldest on the left, today on the right. */

describe('xAt', () => {
  it('puts the oldest point left of today', () => {
    const n = 13;
    expect(xAt(0, n, 326, 14, 12)).toBeLessThan(xAt(n - 1, n, 326, 14, 12));
    expect(xAt(0, n, 326, 14, 12)).toBe(14);
    expect(xAt(n - 1, n, 326, 14, 12)).toBe(326 - 12);
  });

  it('is monotonic and evenly spaced', () => {
    const xs = Array.from({ length: 8 }, (_, i) => xAt(i, 8, 300));
    for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeCloseTo(300 / 7, 9);
  });

  it('a single point sits at the left padding', () => {
    expect(xAt(0, 1, 300, 10, 10)).toBe(10);
  });
});

describe('smoothPath', () => {
  it('starts at the first point and ends at the last, with mid-gap control points', () => {
    expect(smoothPath([[0, 10], [10, 20]])).toBe('M0.0 10.0 C5.0 10.0 5.0 20.0 10.0 20.0');
    expect(smoothPath([])).toBe('');
  });
});
