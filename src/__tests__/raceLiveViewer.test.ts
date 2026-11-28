import { describe, it, expect } from 'vitest';
import { viewerLine, ageLabel, liveButton, STALE_MS, type ViewerRunnerInput } from '@/lib/race-live/viewer';

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
  it('the stale threshold is 3 minutes (LiveTrack posts every 2)', () => {
    expect(STALE_MS).toBe(3 * 60 * 1000);
  });
  it('3 minutes + 1 s is shown as stale, with its age', () => {
    const l = viewerLine({ ...base, position: { distanceM: 23412, at: at(3 * 60_000 + 1000) } }, NOW);
    expect(l).toMatchObject({ kind: 'position', stale: true });
    if (l.kind === 'position') expect(ageLabel(l.ageSec)).toBe('לפני 3 דק׳');
  });
  it('exactly 3 minutes is still fresh', () => {
    expect(viewerLine({ ...base, position: { distanceM: 1000, at: at(3 * 60_000) } }, NOW).stale).toBe(false);
  });
  it('2.5 minutes (one missed-by-a-bit LiveTrack post) is still fresh', () => {
    expect(viewerLine({ ...base, position: { distanceM: 1000, at: at(150_000) } }, NOW).stale).toBe(false);
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

describe('event page "צפייה חיה" button', () => {
  const H = 3600e3;
  const cfg = { active: true, poll_from: new Date(NOW).toISOString(), poll_to: new Date(NOW + 6 * H).toISOString() };
  it('hidden without a config', () => {
    expect(liveButton(null, true, NOW)).toBeNull();
  });
  it('hidden when the config is not active', () => {
    expect(liveButton({ ...cfg, active: false }, true, NOW)).toBeNull();
  });
  it('hidden when the viewer fails the race_live gate', () => {
    expect(liveButton(cfg, false, NOW)).toBeNull();
  });
  it('hidden when the window is unset', () => {
    expect(liveButton({ ...cfg, poll_from: null }, true, NOW)).toBeNull();
  });
  it('hidden more than 2h before poll_from, shown from poll_from − 2h', () => {
    expect(liveButton(cfg, true, NOW - 2 * H - 1000)).toBeNull();
    expect(liveButton(cfg, true, NOW - 2 * H)).toBe('live');
  });
  it('live inside the window', () => {
    expect(liveButton(cfg, true, NOW + 3 * H)).toBe('live');
    expect(liveButton(cfg, true, NOW + 6 * H)).toBe('live');
  });
  it('"results" after poll_to, for 24h, then gone', () => {
    expect(liveButton(cfg, true, NOW + 6 * H + 1000)).toBe('results');
    expect(liveButton(cfg, true, NOW + 30 * H)).toBe('results');
    expect(liveButton(cfg, true, NOW + 30 * H + 1000)).toBeNull();
  });
});
