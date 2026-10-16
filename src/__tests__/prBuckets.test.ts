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

  // 2026-10-16: the club board's 5K #1 was "5,000 m in 27 s" and its 10K #1 a
  // treadmill run whose accelerometer laps read 2:17/km at heart rate 134.
  describe('records only from distance that was measured, at a pace a person can run', () => {
    const road: RunActivityRow = { id: 'road', activity_type: 'running', start_time: '2026-05-01T06:00:00Z', distance: 5000, duration: 1080 };

    it('leaves treadmill and virtual runs out of the bests', () => {
      const treadmill: RunActivityRow = { id: 'tm', activity_type: 'treadmill_running', start_time: '2026-09-13T17:23:16Z', distance: 5000, duration: 900 };
      const virtual: RunActivityRow = { id: 'vr', activity_type: 'virtual_run', start_time: '2026-09-14T17:00:00Z', distance: 5000, duration: 950 };
      expect(computeDistanceBests([road, treadmill, virtual]).find(b => b.key === '5k')?.activityId).toBe('road');
    });

    it('a treadmill-only athlete has no 5K rather than a wrong one', () => {
      const treadmill: RunActivityRow = { id: 'tm', activity_type: 'treadmill_running', start_time: '2026-09-13T17:23:16Z', distance: 5000, duration: 1500 };
      expect(computeDistanceBests([treadmill]).find(b => b.key === '5k')?.seconds).toBeNull();
    });

    it('skips an impossible whole run and keeps the next real one', () => {
      const glitch: RunActivityRow = { id: 'g', activity_type: 'running', start_time: '2025-08-26T07:21:18Z', distance: 5000, duration: 27 };
      expect(computeDistanceBests([road, glitch]).find(b => b.key === '5k')?.activityId).toBe('road');
    });

    it('ignores an impossible stretch inside a run but still scores the run', () => {
      // 5 laps, one of them a GPS jump: 1 km "in 20 s".
      const laps = [300, 20, 300, 300, 300].map(s => ({ distance: 1000, duration: s }));
      const jumpy = { id: 'j', activity_type: 'running', start_time: '2026-03-01T06:00:00Z', distance: 5000, duration: 1500, laps } as RunActivityRow;
      // Summed, the laps say 1220 s (4:04/km) — fast but possible, which is exactly
      // why the check is per lap: the 20 s lap breaks the stretch, no 5 km of laps is
      // left either side of it, and the whole run's honest 1500 s stands.
      expect(computeDistanceBests([jumpy]).find(b => b.key === '5k')).toMatchObject({ seconds: 1500, fromSegment: false });
    });

    it('lets a fast stride through: a 100 m lap is not judged by the floor', () => {
      const laps = [...[290, 290, 290, 290, 290].map(s => ({ distance: 1000, duration: s })), { distance: 100, duration: 15 }];
      const run = { id: 's', activity_type: 'running', start_time: '2026-03-02T06:00:00Z', distance: 5100, duration: 1465, laps } as RunActivityRow;
      expect(computeDistanceBests([run]).find(b => b.key === '5k')).toMatchObject({ seconds: 1450, fromSegment: true });
    });
  });
});
