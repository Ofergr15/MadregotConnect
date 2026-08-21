import { describe, expect, it } from 'vitest';
import { computeDistanceBests, filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';

describe('pr-buckets', () => {
  it('filters out walks and zero-distance/duration rows', () => {
    const rows: RunActivityRow[] = [
      { id: '1', activity_type: 'running', start_time: '2026-01-01T06:00:00Z', distance: 5100, duration: 1500 },
      { id: '2', activity_type: 'walking', start_time: '2026-01-02T06:00:00Z', distance: 3000, duration: 1800 },
      { id: '3', activity_type: 'running', start_time: '2026-01-03T06:00:00Z', distance: 0, duration: 0 },
    ];
    const runs = filterQualifyingRuns(rows);
    expect(runs.map((r) => r.id)).toEqual(['1']);
  });

  it('picks the fastest qualifying run per bucket, normalized to the bucket distance', () => {
    const runs: RunActivityRow[] = [
      // 5.1km in 25:00 -> normalized to exactly 5000m: 1500 * (5000/5100) ≈ 1470s
      { id: 'a', activity_type: 'running', start_time: '2026-01-01T06:00:00Z', distance: 5100, duration: 1500 },
      // A slower 4.9km run should not beat the faster normalized time above.
      { id: 'b', activity_type: 'running', start_time: '2026-01-05T06:00:00Z', distance: 4900, duration: 1600 },
      // Outside the 10K tolerance window entirely.
      { id: 'c', activity_type: 'running', start_time: '2026-01-10T06:00:00Z', distance: 15000, duration: 4000 },
    ];
    const bests = computeDistanceBests(runs);
    const fiveK = bests.find((b) => b.key === '5k');
    expect(fiveK?.activityId).toBe('a');
    expect(fiveK?.seconds).toBe(Math.round(1500 * (5000 / 5100)));

    const tenK = bests.find((b) => b.key === '10k');
    expect(tenK?.seconds).toBeNull();
    expect(tenK?.activityId).toBeNull();
  });

  it('returns null bests when no run qualifies for a bucket', () => {
    const bests = computeDistanceBests([]);
    expect(bests.every((b) => b.seconds === null && b.activityId === null)).toBe(true);
  });
});
