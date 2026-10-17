import { describe, it, expect } from 'vitest';
import { classifyRun, oneRowPerRun, paceAtHr, type PaceRunInput } from '@/lib/fitness/pace-at-hr';

/**
 * #105 — pace at the same heart rate (mockup fitness-105/mockup.html). The shapes
 * below are the ones measured on Yair's real runs on 2026-10-17.
 */
const lap = (m: number, s: number, hr = 140) => ({ distance: m, duration: s, averageHR: hr });
const run = (over: Partial<PaceRunInput> & { laps: unknown[] }): PaceRunInput => ({
  id: Math.random().toString(36).slice(2), start_time: '2026-10-10T05:00:00+00:00', activity_type: 'running',
  distance: (over.laps as Array<{ distance: number }>).reduce((a, l) => a + l.distance, 0), duration: 3600, ...over,
});
const km = (n: number, pace: number, hr = 140) => Array.from({ length: n }, () => lap(1000, pace, hr));

describe('classifyRun', () => {
  it('an even run is easy', () => {
    expect(classifyRun(run({ laps: km(10, 300) }))).toBe('easy');
  });

  it('hills: fast reps with walks back down are intervals', () => {
    const hills = [...km(3, 290), ...Array.from({ length: 5 }, () => [lap(200, 40, 165), lap(90, 60, 150)]).flat(), ...km(2, 300)];
    expect(classifyRun(run({ laps: hills }))).toBe('interval');
  });

  it('a long run with pickups and two water stops stays easy (Yair, 41.9 km, 16.10)', () => {
    const long = [...km(20, 290), lap(150, 30), lap(150, 30), lap(150, 30), lap(25, 18), lap(25, 20), ...km(20, 285)];
    expect(classifyRun(run({ laps: long }))).toBe('easy');
  });

  it('getting faster through the run is progressive', () => {
    expect(classifyRun(run({ laps: [...km(4, 330), ...km(4, 310), ...km(4, 290)] }))).toBe('progressive');
  });

  it('the plan saying intervals wins over a steady-looking run', () => {
    expect(classifyRun(run({ laps: km(10, 300) }), 'interval')).toBe('interval');
  });

  it('a treadmill run never counts: its pace is the watch guessing', () => {
    expect(classifyRun(run({ activity_type: 'treadmill_running', laps: km(10, 300) }))).toBe('skip');
  });
});

describe('oneRowPerRun', () => {
  it('a Garmin run and its Strava copy count once, the copy with more laps kept', () => {
    const g = run({ id: 'garmin', laps: km(10, 300) });
    const s = run({ id: 'strava', start_time: '2026-10-10T05:00:30+00:00', laps: km(1, 300) });
    expect(oneRowPerRun([s, g]).map(r => r.id)).toEqual(['garmin']);
  });
});

describe('paceAtHr', () => {
  it('pace per band, only where the band has 5 km, faster numbers are smaller', () => {
    const early = run({ start_time: '2026-09-20T05:00:00+00:00', laps: km(6, 330, 142) });
    const late = run({ start_time: '2026-10-15T05:00:00+00:00', laps: km(6, 310, 142) });
    const thin = run({ start_time: '2026-10-15T07:00:00+00:00', laps: km(3, 280, 152) });
    const r = paceAtHr([early, late, thin], { today: '2026-10-17', weeks: 5 });
    const p140 = r.bands[140].map(p => p.paceSecPerKm);
    expect(p140[p140.length - 1]).toBe(320); // both runs in the last 28 days: 12 km at 5:30 and 5:10
    expect(r.bands[150].every(p => p.paceSecPerKm == null)).toBe(true); // 3 km is not a point
    expect(r.headline).toMatchObject({ band: 140 });
  });

  it('intervals are listed but never in the bands', () => {
    const hills = run({ laps: [...km(3, 290, 141), ...Array.from({ length: 5 }, () => [lap(200, 40, 165), lap(90, 60, 150)]).flat(), ...km(3, 300, 141)] });
    const r = paceAtHr([hills], { today: '2026-10-17', weeks: 4 });
    expect(r.runs.map(x => x.kind)).toEqual(['interval']);
    expect(Object.keys(r.bands)).toEqual([]);
  });
});
