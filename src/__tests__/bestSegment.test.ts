import { describe, it, expect } from 'vitest';
import { bestSegmentSeconds } from '@/lib/prs/best-segment';
import { computeDistanceBests, filterQualifyingRuns } from '@/lib/prs/pr-buckets';

/** n × 1 km laps at the given per-lap seconds. */
const laps = (...seconds: number[]) => seconds.map((s) => ({ distance: 1000, duration: s }));

describe('bestSegmentSeconds', () => {
  it('finds the fastest window, not the first or the average', () => {
    // 6 km: slow, slow, fast, fast, fast, slow. The fastest 3 km is laps 3-5.
    expect(bestSegmentSeconds(laps(360, 360, 300, 300, 300, 360), 3000)).toBe(900);
  });

  it('charges a partial final lap pro-rata', () => {
    // 1.5 km target across 1 km at 300s + half of a 1 km lap at 400s.
    expect(bestSegmentSeconds(laps(300, 400), 1500)).toBe(500);
  });

  it('returns null when the laps never reach the target', () => {
    expect(bestSegmentSeconds(laps(300, 300, 300, 300), 5000)).toBeNull();
  });

  it('returns null for missing, empty or unusable laps', () => {
    expect(bestSegmentSeconds(null, 5000)).toBeNull();
    expect(bestSegmentSeconds(undefined, 5000)).toBeNull();
    expect(bestSegmentSeconds([], 5000)).toBeNull();
    // No usable duration on any lap — a row whose laps carry distance only.
    expect(bestSegmentSeconds([{ distance: 1000 }, { distance: 1000 }], 1000)).toBeNull();
  });

  it('reads Strava laps, preferring moving_time over elapsed_time', () => {
    // The same lap the Garmin sync stores as duration: 355. elapsed_time (392)
    // would make the identical run ~10% slower depending on which sync won.
    const strava = [{ distance: 1000, moving_time: 355, elapsed_time: 392 }];
    expect(bestSegmentSeconds(strava, 1000)).toBe(355);
    // elapsed_time is still used when it is all there is.
    expect(bestSegmentSeconds([{ distance: 1000, elapsed_time: 392 }], 1000)).toBe(392);
  });

  it('skips laps with no distance instead of dividing by zero', () => {
    const withGarbage = [{ distance: 0, duration: 90 }, ...laps(300, 300)];
    expect(bestSegmentSeconds(withGarbage, 2000)).toBe(600);
  });
});

describe('computeDistanceBests with laps', () => {
  const base = { activity_type: 'running', start_time: '2026-08-21T05:00:00Z' };

  it('takes a bucket time from inside a longer run', () => {
    // A 10 km run whose first 5 km were 20:00 and second 5 km 25:00. Before
    // segments this run could only ever have been a 10K, and its 5K bucket
    // stayed empty however fast the first half was.
    const run = {
      ...base,
      id: 'a',
      activity_name: 'long',
      distance: 10000,
      duration: 2700,
      laps: laps(240, 240, 240, 240, 240, 300, 300, 300, 300, 300),
    };
    const bests = computeDistanceBests(filterQualifyingRuns([run]));
    const fiveK = bests.find((b) => b.key === '5k')!;
    expect(fiveK.seconds).toBe(1200);
    expect(fiveK.fromSegment).toBe(true);
    expect(fiveK.sourceMeters).toBe(10000);
  });

  it('prefers the segment over the same run scaled, because scaling averages the pace', () => {
    // 5.20 km with a fast first 5 km. Scaled whole-activity: 1500 * (5000/5200)
    // = 1442s. The 5 km actually run: 1400s.
    const run = {
      ...base,
      id: 'b',
      activity_name: 'tempo',
      distance: 5200,
      duration: 1500,
      laps: [...laps(280, 280, 280, 280, 280), { distance: 200, duration: 100 }],
    };
    const fiveK = computeDistanceBests(filterQualifyingRuns([run])).find((b) => b.key === '5k')!;
    expect(fiveK.seconds).toBe(1400);
    expect(fiveK.fromSegment).toBe(true);
  });

  it('still scales the whole run when it is shorter than the bucket', () => {
    // 4.80 km has no 5 km inside it, so the tolerance window is the only route —
    // the behaviour every row without laps stored still relies on.
    const run = { ...base, id: 'c', activity_name: 'short', distance: 4800, duration: 1440, laps: laps(300, 300, 300, 300, 240) };
    const fiveK = computeDistanceBests(filterQualifyingRuns([run])).find((b) => b.key === '5k')!;
    expect(fiveK.seconds).toBe(1500);
    expect(fiveK.fromSegment).toBe(false);
  });

  it('leaves lapless rows exactly as they were', () => {
    const run = { ...base, id: 'd', activity_name: 'no laps', distance: 5010, duration: 1298 };
    const fiveK = computeDistanceBests(filterQualifyingRuns([run])).find((b) => b.key === '5k')!;
    expect(fiveK.seconds).toBe(Math.round(1298 * (5000 / 5010)));
    expect(fiveK.fromSegment).toBe(false);
  });
});
