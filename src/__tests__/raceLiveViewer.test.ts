import { describe, it, expect } from 'vitest';
import { viewerLine, ageLabel, STALE_MS, type ViewerRunnerInput } from '@/lib/race-live/viewer';

const NOW = Date.parse('2026-12-06T09:00:00Z');
const base: ViewerRunnerInput = { state: 'running', splits: [], lastPoint: '25k', lastSec: 7293, predictedSec: 12400, position: null };
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('live viewer — graceful degradation', () => {
  it('a fresh GPS position is live', () => {
    const l = viewerLine({ ...base, position: { distanceM: 23412, elapsedSec: 6730, at: at(30_000) } }, NOW);
    expect(l).toMatchObject({ kind: 'position', stale: false, ageSec: 30 });
    expect(l.text).toContain('23.4');
    expect(l.text).toContain('1:52:10');
  });
  it('a position older than 2 minutes is shown as stale, with its age', () => {
    const l = viewerLine({ ...base, position: { distanceM: 23412, at: at(STALE_MS + 1000) } }, NOW);
    expect(l).toMatchObject({ kind: 'position', stale: true });
    if (l.kind === 'position') expect(ageLabel(l.ageSec)).toBe('לפני 2 דק׳');
  });
  it('exactly 2 minutes is still fresh', () => {
    expect(viewerLine({ ...base, position: { distanceM: 1000, at: at(STALE_MS) } }, NOW).stale).toBe(false);
  });
  it('no GPS → the last split', () => {
    expect(viewerLine(base, NOW)).toEqual({ kind: 'last_split', text: '25K · 2:01:33', stale: false });
  });
  it('a broken position (bad timestamp) falls back to the last split, never NaN', () => {
    const l = viewerLine({ ...base, position: { distanceM: 5000, at: 'not a date' } }, NOW);
    expect(l.kind).toBe('last_split');
    expect(l.text).not.toContain('NaN');
  });
  it('no split and no GPS → not started', () => {
    expect(viewerLine({ ...base, lastPoint: null, lastSec: null }, NOW).kind).toBe('not_started');
  });
  it('finished shows the finish time even with an old position', () => {
    const l = viewerLine({ ...base, state: 'finished', lastPoint: 'finish', lastSec: 12345, position: { distanceM: 42195, at: at(3_600_000) } }, NOW);
    expect(l).toEqual({ kind: 'finished', text: 'סיום · 3:25:45', stale: false });
  });
  it('age labels', () => {
    expect(ageLabel(45)).toBe('לפני 45 שנ׳');
    expect(ageLabel(3 * 3600)).toBe('לפני 3 שע׳');
  });
});
