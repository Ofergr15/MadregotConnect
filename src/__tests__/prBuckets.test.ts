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
      // 4.9km — 2% short, so out of the window entirely now (see the asymmetry
      // case below). It was never going to win on time either way.
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

  // The window is asymmetric on purpose, and this is the case that made it so: a
  // 41.2 km run reported as a "2:58:57 marathon" invents a whole kilometre at
  // average pace, on the one stretch of a marathon where nobody runs their
  // average. Over the bucket is a different claim from under it — the distance
  // there really was covered.
  it('scales a long run down to the bucket but never a short one up', () => {
    const bests = (rows: RunActivityRow[]) => computeDistanceBests(rows);
    const short = bests([
      { id: 'short', activity_type: 'running', start_time: '2026-01-01T06:00:00Z', distance: 41200, duration: 10485 },
    ]).find((b) => b.key === 'fm');
    expect(short?.seconds).toBeNull();

    const long = bests([
      { id: 'long', activity_type: 'running', start_time: '2026-01-01T06:00:00Z', distance: 43000, duration: 11000 },
    ]).find((b) => b.key === 'fm');
    expect(long?.activityId).toBe('long');
    expect(long?.seconds).toBe(Math.round(11000 * (42195 / 43000)));
  });

  // GPS distance error is the only thing the low side is there to forgive, and
  // 1% covers it: a watch that read 4.96 km on a measured 5 km still counts.
  it('still accepts a run a GPS-error short of the bucket', () => {
    const best = computeDistanceBests([
      { id: 'gps', activity_type: 'running', start_time: '2026-01-01T06:00:00Z', distance: 4960, duration: 1200 },
    ]).find((b) => b.key === '5k');
    expect(best?.activityId).toBe('gps');
  });

  it('returns null bests when no run qualifies for a bucket', () => {
    const bests = computeDistanceBests([]);
    expect(bests.every((b) => b.seconds === null && b.activityId === null)).toBe(true);
  });
});
