// Task 82: race-live viewer — GPS finish detection, results freeze after the race window.
import { describe, it, expect } from 'vitest';
import { boardPhase, isGpsFinish, GPS_FINISH_MIN_M, resultsOrder, viewerLine, RESULTS_GRACE_MS, type ViewerRunnerInput } from '@/lib/race-live/viewer';

const NOW = Date.parse('2026-12-06T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const split = (point: string, elapsedSec: number) => ({ point, elapsedSec }) as unknown as ViewerRunnerInput['splits'][number];
const r = (o: Partial<ViewerRunnerInput>): ViewerRunnerInput => ({ state: 'running', splits: [], lastPoint: null, lastSec: null, predictedSec: null, position: null, ...o });

describe('GPS finish detection', () => {
  it('42.3 km and over counts; 42.25 km (and the old 42.195 − 150 m) does not', () => {
    expect(GPS_FINISH_MIN_M).toBe(42_300);
    expect(isGpsFinish(42_300)).toBe(true);
    expect(isGpsFinish(42_800)).toBe(true);
    expect(isGpsFinish(42_250)).toBe(false);
    expect(isGpsFinish(42_195)).toBe(false);
    expect(isGpsFinish(42_100)).toBe(false);
    expect(isGpsFinish(NaN)).toBe(false);
    expect(isGpsFinish(null)).toBe(false);
  });
  it('at 42.25 km by GPS the runner is still running, not "finished per GPS"', () => {
    const l = viewerLine(r({ splits: [split('40k', 11000)], lastPoint: '40k', lastSec: 11000, position: { distanceM: 42_250, elapsedSec: 11_600, at: at(30_000) } }), NOW);
    expect(l.kind).toBe('position');
  });
  it('a runner at 42.3 km by GPS, before the official split, shows "finished per GPS" — never stale', () => {
    const l = viewerLine(r({ splits: [split('40k', 11000)], lastPoint: '40k', lastSec: 11000, position: { distanceM: 42_300, elapsedSec: 11_620, at: at(10 * 60_000) } }), NOW);
    expect(l.kind).toBe('gps_finished');
    expect(l.stale).toBe(false);
    expect(l.text).toContain('3:13:40');
  });
  it('the official finish wins over the GPS', () => {
    const l = viewerLine(r({ state: 'finished', lastPoint: 'finish', lastSec: 11_700, position: { distanceM: 42_300, elapsedSec: 11_620, at: at(0) } }), NOW);
    expect(l).toMatchObject({ kind: 'finished', text: 'סיום · 3:15:00' });
  });
});

describe('results freeze', () => {
  const end = new Date(NOW - RESULTS_GRACE_MS - 1).toISOString();
  it('live until window end + grace, then results; no window → live', () => {
    expect(boardPhase(NOW, end)).toBe('results');
    expect(boardPhase(NOW, new Date(NOW - RESULTS_GRACE_MS + 60_000).toISOString())).toBe('live');
    expect(boardPhase(NOW, null)).toBe('live');
    expect(boardPhase(NOW, 'not a date')).toBe('live');
  });
  it('frozen: an unfinished runner shows the last split, not an old GPS position', () => {
    const runner = r({ splits: [split('30k', 9000)], lastPoint: '30k', lastSec: 9000, position: { distanceM: 31_000, elapsedSec: 9300, at: at(3 * 3600e3) } });
    expect(viewerLine(runner, NOW).stale).toBe(true);
    const l = viewerLine(runner, NOW, { frozen: true });
    expect(l).toMatchObject({ kind: 'last_split', stale: false });
  });
  it('frozen: GPS-only finish no longer claims a finish (no official time)', () => {
    const runner = r({ splits: [split('40k', 11000)], lastPoint: '40k', lastSec: 11000, position: { distanceM: 42_300, elapsedSec: 11_620, at: at(0) } });
    expect(viewerLine(runner, NOW, { frozen: true }).kind).toBe('last_split');
  });
  it('results order: finishers by time (ties stable), then furthest split, then not started', () => {
    const a = { ...r({ state: 'finished', lastSec: 11_000, splits: [split('finish', 11_000)] }), id: 'a' };
    const b = { ...r({ state: 'finished', lastSec: 10_500, splits: [split('finish', 10_500)] }), id: 'b' };
    const c = { ...r({ state: 'finished', lastSec: 11_000, splits: [split('finish', 11_000)] }), id: 'c' };
    const d = { ...r({ splits: [split('10k', 3000)] }), id: 'd' };
    const e = { ...r({ splits: [split('10k', 3000), split('20k', 6000)] }), id: 'e' };
    const f = { ...r({}), id: 'f' };
    expect(resultsOrder([f, d, a, e, c, b]).map((x) => x.id)).toEqual(['b', 'a', 'c', 'e', 'd', 'f']);
  });
});
