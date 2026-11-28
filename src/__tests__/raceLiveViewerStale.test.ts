import { describe, expect, it } from 'vitest';
import { viewerLine, type ViewerRunnerInput } from '@/lib/race-live/viewer';
import { boardFreshness, staleDetail, updatedLabel } from '@/lib/race-live/viewerStale';

// Task 147: what the viewer shows once positions stop arriving.
const NOW = Date.parse('2026-12-06T09:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const base: ViewerRunnerInput = { state: 'running', splits: [], lastPoint: '25k', lastSec: 7293, predictedSec: 12400, position: null };

describe('stale row → last split + "עודכן לפני X דק׳"', () => {
  it('a stale position carries the last official split and its age', () => {
    const r = { ...base, position: { distanceM: 23412, elapsedSec: 6730, at: at(4 * 60_000 + 20_000) } };
    const line = viewerLine(r, NOW);
    expect(staleDetail(r, line)).toEqual({ lastSplit: '25K · 2:01:33', updated: 'עודכן לפני 4 דק׳' });
  });
  it('stale before any split: only the age', () => {
    const r = { ...base, lastPoint: null, lastSec: null, position: { distanceM: 900, at: at(10 * 60_000) } };
    expect(staleDetail(r, viewerLine(r, NOW))).toEqual({ lastSplit: null, updated: 'עודכן לפני 10 דק׳' });
  });
  it('a fresh position has no stale detail', () => {
    const r = { ...base, position: { distanceM: 23412, at: at(60_000) } };
    expect(staleDetail(r, viewerLine(r, NOW))).toBeNull();
  });
  it('the threshold is the viewer\'s (3 min): 2:30 is fresh, 3:01 is stale', () => {
    const r = (ms: number) => ({ ...base, position: { distanceM: 1000, at: at(ms) } });
    expect(staleDetail(r(150_000), viewerLine(r(150_000), NOW))).toBeNull();
    expect(staleDetail(r(181_000), viewerLine(r(181_000), NOW))?.updated).toBe('עודכן לפני 3 דק׳');
  });
  it('rows that are not GPS rows never get it (last split, finished, not started)', () => {
    expect(staleDetail(base, viewerLine(base, NOW))).toBeNull();
    const fin = { ...base, state: 'finished' as const, lastPoint: 'finish', lastSec: 12345, position: { distanceM: 42195, at: at(3_600_000) } };
    expect(staleDetail(fin, viewerLine(fin, NOW))).toBeNull();
    const ns = { ...base, lastPoint: null, lastSec: null };
    expect(staleDetail(ns, viewerLine(ns, NOW))).toBeNull();
  });
  it('hours-old positions read in hours', () => {
    expect(updatedLabel(2 * 3600 + 5)).toBe('עודכן לפני 2 שע׳');
    expect(updatedLabel(30)).toBe('עודכן לפני 30 שנ׳');
  });
});

describe('board-wide freshness', () => {
  const run = (msAgo: number | null, state: ViewerRunnerInput['state'] = 'running') =>
    ({ state, position: msAgo == null ? null : { distanceM: 1000, at: at(msAgo) } });

  it('one fresh runner keeps the board live', () => {
    expect(boardFreshness([run(20 * 60_000), run(30_000)], NOW)).toMatchObject({ stale: false, ageSec: 30 });
  });
  it('every position older than 3 min → stale, aged by the NEWEST', () => {
    expect(boardFreshness([run(20 * 60_000), run(5 * 60_000)], NOW)).toEqual({ newestAtMs: NOW - 300_000, ageSec: 300, stale: true });
  });
  it('finished runners stopped sharing on purpose and do not count', () => {
    expect(boardFreshness([run(30_000, 'finished'), run(6 * 60_000)], NOW).stale).toBe(true);
  });
  it('no positions at all (nobody shares) is not "stale" — the rows already say last split', () => {
    expect(boardFreshness([run(null), run(null)], NOW)).toEqual({ newestAtMs: null, ageSec: null, stale: false });
    expect(boardFreshness([], NOW).stale).toBe(false);
  });
  it('a broken timestamp is ignored, never NaN', () => {
    const r = { state: 'running' as const, position: { distanceM: 1, at: 'nope' } };
    expect(boardFreshness([r], NOW)).toEqual({ newestAtMs: null, ageSec: null, stale: false });
  });
});
