// Night queue #60: cron/badges ran the roster serially under maxDuration 60. Now batches of 6, 300 s.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inBatches } from '@/lib/badges/batches';

describe('inBatches', () => {
  it('runs every item, never more than `size` at once', async () => {
    let live = 0, peak = 0;
    const seen: number[] = [];
    await inBatches(Array.from({ length: 20 }, (_, i) => i), 6, async (i) => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(i); live--;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });
  it('size < 1 is treated as 1; empty input is a no-op', async () => {
    let n = 0;
    await inBatches([1, 2], 0, async () => { n++; });
    await inBatches([], 5, async () => { n++; });
    expect(n).toBe(2);
  });
  it('the route allows 300 s and uses the batches', () => {
    const src = readFileSync('src/app/api/cron/badges/route.ts', 'utf8');
    expect(src).toMatch(/export const maxDuration = 300;/);
    expect(src).toMatch(/inBatches\(/);
  });
});
