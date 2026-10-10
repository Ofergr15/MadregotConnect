import { describe, expect, it } from 'vitest';
import { findStoredMatch, sameClock } from '@/lib/activity-dedup';

/**
 * One run recorded twice (Garmin + Strava) with distances that disagree, measured
 * on prod 2026-10-10: five runs were showing twice in the feed. The treadmill pair
 * is the canonical one — corrected on Garmin to 8,000 m, 9,238 m on Strava.
 */
const at = (iso: string) => new Date(iso).getTime();

describe('same clock, any distance', () => {
  it('a corrected treadmill run is one run (prod pair, 2026-08-18)', () => {
    const stored = [{ id: 's', source: 'strava', start_time: '2026-08-18T18:37:41Z', distance: 9238, duration: 2501 }];
    expect(findStoredMatch(stored, '2026-08-18T18:37:41Z', 8000, 2456)?.id).toBe('s');
  });

  it('a time-only manual entry (no distance) twins with the watch recording', () => {
    const stored = [{ id: 'm', source: 'strava', start_time: '2026-10-01T06:00:30Z', distance: 0, duration: 3000 }];
    expect(findStoredMatch(stored, '2026-10-01T06:00:00Z', 10050, 3020)?.id).toBe('m');
  });

  it('consecutive reps still never merge: they do not share the clock', () => {
    const stored = [{ id: 'r1', source: 'strava', start_time: '2026-09-09T06:00:00Z', distance: 2000, duration: 430 }];
    expect(findStoredMatch(stored, '2026-09-09T06:09:30Z', 2000, 430)).toBeNull();
  });

  it('same start but very different lengths is not one run', () => {
    expect(sameClock(at('2026-10-01T06:00:00Z'), 600, at('2026-10-01T06:00:10Z'), 3600)).toBe(false);
  });

  it('needs both durations; without them the old distance rule still applies', () => {
    expect(sameClock(at('2026-10-01T06:00:00Z'), null, at('2026-10-01T06:00:00Z'), 3600)).toBe(false);
    const stored = [{ id: 'x', source: 'strava', start_time: '2026-10-01T06:00:00Z', distance: 9238, duration: null }];
    expect(findStoredMatch(stored, '2026-10-01T06:00:00Z', 8000, 2456)).toBeNull(); // 15% apart, no clock evidence
    expect(findStoredMatch(stored, '2026-10-01T06:00:00Z', 9100, 2456)?.id).toBe('x'); // within 10%: old rule
  });

  it('three minutes apart is not "the same clock"', () => {
    expect(sameClock(at('2026-10-01T06:00:00Z'), 3000, at('2026-10-01T06:03:00Z'), 3000)).toBe(false);
  });
});
