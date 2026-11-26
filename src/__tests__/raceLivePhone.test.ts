import { describe, it, expect } from 'vitest';
import { parsePhonePosition, phoneWriteAllowed, phoneEtaSec, positionSharingOn, PHONE_MAX_DISTANCE_M } from '@/lib/race-live/phone';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOW = Date.parse('2026-12-06T09:30:00Z');
const at = (sAgo = 0) => new Date(NOW - sAgo * 1000).toISOString();
const cfg = { active: true, poll_from: '2026-12-06T06:00:00Z', poll_to: '2026-12-06T15:00:00Z' };
const pos = (d = 10000, sAgo = 0) => ({ lat: 39.47, lon: -0.37, distanceM: d, elapsedSec: 3000, at: at(sAgo) });

describe('race live — phone position (b24)', () => {
  it('parses a sane body and refuses junk', () => {
    expect(parsePhonePosition({ lat: 39.47, lon: -0.37, distanceM: 12000.4, elapsedSec: 3600.6, at: at() }, NOW)).toEqual({ lat: 39.47, lon: -0.37, distanceM: 12000, elapsedSec: 3601, at: at() });
    expect(parsePhonePosition({ lat: 91, lon: 0, distanceM: 1, elapsedSec: 1, at: at() }, NOW)).toBeNull();
    expect(parsePhonePosition({ lat: 1, lon: 1, distanceM: PHONE_MAX_DISTANCE_M + 1, elapsedSec: 1, at: at() }, NOW)).toBeNull();
    expect(parsePhonePosition({ lat: 1, lon: 1, distanceM: 1, elapsedSec: 8 * 3600, at: at() }, NOW)).toBeNull();
    expect(parsePhonePosition({ lat: 1, lon: 1, distanceM: 1, elapsedSec: 1, at: at(20 * 60) }, NOW)).toBeNull();  // stale
    expect(parsePhonePosition({ lat: 1, lon: 1, distanceM: 1, elapsedSec: 1, at: at(-5 * 60) }, NOW)).toBeNull();  // future
    expect(parsePhonePosition(null, NOW)).toBeNull();
  });

  it('writes only inside the window, for a runner on the board who has not opted out', () => {
    const ok = { nowMs: NOW, cfg, entry: { live_opt_out: false }, prev: null, next: pos() };
    expect(phoneWriteAllowed(ok)).toBeNull();
    expect(phoneWriteAllowed({ ...ok, cfg: { ...cfg, active: false } })).toBe('out-of-window');
    expect(phoneWriteAllowed({ ...ok, nowMs: Date.parse('2026-12-06T16:00:00Z') })).toBe('out-of-window');
    expect(phoneWriteAllowed({ ...ok, cfg: null })).toBe('out-of-window');
    expect(phoneWriteAllowed({ ...ok, entry: null })).toBe('not-on-board');
    expect(phoneWriteAllowed({ ...ok, entry: { live_opt_out: true } })).toBe('opted-out');
  });

  it('rate-limits and keeps distance growing', () => {
    const base = { nowMs: NOW, cfg, entry: { live_opt_out: false } };
    expect(phoneWriteAllowed({ ...base, prev: { distance_m: 9000, at: at(10) }, next: pos(10000) })).toBe('too-soon');
    expect(phoneWriteAllowed({ ...base, prev: { distance_m: 9000, at: at(60) }, next: pos(10000) })).toBeNull();
    expect(phoneWriteAllowed({ ...base, prev: { distance_m: 15000, at: at(60) }, next: pos(10000) })).toBe('not-monotonic');
    expect(phoneWriteAllowed({ ...base, prev: { distance_m: 10100, at: at(60) }, next: pos(10000) })).toBeNull();   // jitter
  });

  it('estimates the finish from the pace so far', () => {
    expect(phoneEtaSec(21097.5, 6000)).toBe(12000);
    expect(phoneEtaSec(500, 200)).toBeNull();
    expect(phoneEtaSec(42195, 12000)).toBeNull();
  });

  it('Q26-5: a stop holds until an explicit resume; the watch row is no baseline for the phone', () => {
    const ok = { nowMs: NOW, cfg, entry: { live_opt_out: false, sharing_stopped_at: at(300) }, prev: null, next: pos() };
    expect(phoneWriteAllowed(ok)).toBe('sharing-stopped');
    expect(phoneWriteAllowed({ ...ok, resume: true })).toBeNull();
    expect(phoneWriteAllowed({ ...ok, entry: { live_opt_out: true, sharing_stopped_at: null }, resume: true })).toBe('opted-out');
    const fresh = { nowMs: NOW, cfg, entry: { live_opt_out: false }, next: pos(10000) };
    // A watch point 5 s ago and 2 km ahead: not the phone's too-soon / not-monotonic.
    expect(phoneWriteAllowed({ ...fresh, prev: { distance_m: 12500, at: at(5), source: 'livetrack' } })).toBeNull();
    expect(phoneWriteAllowed({ ...fresh, prev: { distance_m: 12500, at: at(5), source: 'phone' } })).toBe('too-soon');
    expect(positionSharingOn({ live_opt_out: false })).toBe(true);
    expect(positionSharingOn({ live_opt_out: false, sharing_stopped_at: at() })).toBe(false);
    expect(positionSharingOn(null)).toBe(false);
  });

  it('Q26-5: DELETE stores the stop before deleting; both writers go through writePosition', () => {
    const route = readFileSync(join(__dirname, '..', 'app/api/race-live/[eventId]/position/route.ts'), 'utf8');
    const del = route.slice(route.indexOf('export async function DELETE'));
    expect(del.indexOf('sharing_stopped_at: new Date()')).toBeGreaterThan(-1);
    expect(del.indexOf('sharing_stopped_at: new Date()')).toBeLessThan(del.indexOf("from('race_positions').delete()"));
    expect(route).not.toMatch(/details: error\.message/);
    expect(route).toMatch(/isFeatureEnabled\([^)]*\)\.catch\(/);
    const server = readFileSync(join(__dirname, '..', 'lib/race-live/server.ts'), 'utf8');
    // The only upserts into race_positions are inside writePosition.
    expect(server.match(/from\('race_positions'\)\.upsert/g)?.length).toBe(2);
    expect(route).not.toMatch(/from\('race_positions'\)\.upsert/);
  });
});
