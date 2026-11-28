import { describe, expect, it } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { finishedAtMs, shareExpired, GPS_FINISH_MIN_M, SHARE_AFTER_FINISH_MS } from '@/lib/race-live/share-expiry';
import { liveBoard } from '@/lib/race-live/server';

const START = Date.parse('2026-12-06T07:15:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600e3;

describe('finishedAtMs', () => {
  it('the finish split’s recorded_at when there is one', () => {
    expect(finishedAtMs({ finishRecordedAt: iso(START + 3 * H) })).toBe(START + 3 * H);
  });
  it('a GPS-only finish: start + elapsed scaled to 42.195 km', () => {
    // 42.5 km in 3:10 → on the line at 3:10 × 42195/42500 after the start.
    const elapsed = 3 * 3600 + 600;
    const at = START + elapsed * 1000;
    const got = finishedAtMs({ position: { distance_m: 42_500, elapsed_sec: elapsed, at: iso(at) } })!;
    expect(got).toBe(Math.round(START + elapsed * (42195 / 42500) * 1000));
    expect(got).toBeLessThan(at);
  });
  it('under the GPS finish distance is not a finish', () => {
    expect(finishedAtMs({ position: { distance_m: GPS_FINISH_MIN_M - 1, elapsed_sec: 11000, at: iso(START) } })).toBeNull();
  });
  it('both known → the earlier one', () => {
    const pos = { distance_m: 42_400, elapsed_sec: 10_800, at: iso(START + 10_800_000) };
    expect(finishedAtMs({ finishRecordedAt: iso(START + 5 * H), position: pos })).toBeLessThan(START + 5 * H);
  });
  it('a GPS finish with no elapsed falls back to the point’s own time', () => {
    expect(finishedAtMs({ position: { distance_m: 42_400, elapsed_sec: null, at: iso(START) } })).toBe(START);
  });
});

describe('shareExpired', () => {
  const pos = (atMs: number, d = 20_000, e = 6000) => ({ distance_m: d, elapsed_sec: e, at: iso(atMs) });

  it('serves a running runner’s position', () => {
    expect(shareExpired({ nowMs: START + H, position: pos(START + H) })).toBeNull();
  });
  it('sharing stopped: a position from before (or at) the stop is not served', () => {
    expect(shareExpired({ nowMs: START + H, position: pos(START + H - 60_000), sharingStoppedAt: iso(START + H - 30_000) })).toBe('sharing-stopped');
    expect(shareExpired({ nowMs: START + H, position: pos(START + H), sharingStoppedAt: iso(START + H) })).toBe('sharing-stopped');
  });
  it('a point written after the stop (a re-share) is served again', () => {
    expect(shareExpired({ nowMs: START + H, position: pos(START + H), sharingStoppedAt: iso(START + H - 60_000) })).toBeNull();
  });
  it('an unreadable stop stamp fails closed', () => {
    expect(shareExpired({ nowMs: START, position: pos(START), sharingStoppedAt: 'garbage' })).toBe('sharing-stopped');
  });
  it('finish + 2 h: served up to the second, not after', () => {
    const fin = iso(START + 3 * H);
    expect(shareExpired({ nowMs: START + 3 * H + SHARE_AFTER_FINISH_MS, position: pos(START + 5 * H), finishRecordedAt: fin })).toBeNull();
    expect(shareExpired({ nowMs: START + 3 * H + SHARE_AFTER_FINISH_MS + 1, position: pos(START + 5 * H), finishRecordedAt: fin })).toBe('finished');
  });
  it('a GPS-only finish (the phone stops posting at the line) stops being served 2 h later', async () => {
    // Last point at 42.4 km, 3:05 after the start; the client stops sharing at the finish distance.
    const elapsed = 3 * 3600 + 300;
    const p = { distance_m: 42_400, elapsed_sec: elapsed, at: iso(START + elapsed * 1000) };
    const fin = finishedAtMs({ position: p })!;
    expect(shareExpired({ nowMs: fin + SHARE_AFTER_FINISH_MS, position: p })).toBeNull();
    expect(shareExpired({ nowMs: fin + SHARE_AFTER_FINISH_MS + 1, position: p })).toBe('finished');
  });
});

describe('liveBoard applies the expiry', () => {
  const EVENT = uid();
  const RUNNER = uid();
  const FAN = uid();
  function seed(finishRecordedAt: string | null) {
    const db = createMemoryDb({
      schema: {
        race_live_config: ['event_id', 'source', 'active', 'last_polled_at', 'poll_from', 'poll_to'],
        race_entries: ['event_id', 'athlete_id', 'bib', 'live_opt_out', 'goal_sec', 'livetrack_url', 'livetrack_state'],
        race_splits: ['event_id', 'athlete_id', 'point', 'elapsed_sec', 'source', 'recorded_at'],
        race_positions: ['event_id', 'athlete_id', 'lat', 'lon', 'distance_m', 'elapsed_sec', 'at'],
        race_map_viewers: ['event_id', 'athlete_id'],
        athletes: ['id', 'name', 'avatar_url'],
        event_group_assignments: ['event_id', 'athlete_id', 'group_id'],
      },
    });
    db.tables.race_live_config.push({ event_id: EVENT, source: 'manual', active: true, last_polled_at: null, poll_from: iso(START - H), poll_to: iso(START + 8 * H) });
    db.tables.race_entries.push({ event_id: EVENT, athlete_id: RUNNER, bib: '1', live_opt_out: false, goal_sec: 10800 });
    db.tables.athletes.push({ id: RUNNER, name: 'Runner', avatar_url: null });
    db.tables.race_map_viewers.push({ event_id: EVENT, athlete_id: FAN });
    db.tables.race_positions.push({ event_id: EVENT, athlete_id: RUNNER, lat: 39.47, lon: -0.37, distance_m: 42_000, elapsed_sec: 10_700, at: iso(START + 3 * H) });
    if (finishRecordedAt) {
      db.tables.race_splits.push(
        { event_id: EVENT, athlete_id: RUNNER, point: 'start', elapsed_sec: 0, source: 'manual', recorded_at: iso(START) },
        { event_id: EVENT, athlete_id: RUNNER, point: 'finish', elapsed_sec: 10_800, source: 'manual', recorded_at: finishRecordedAt },
      );
    }
    return db;
  }
  const positionAt = async (db: ReturnType<typeof createMemoryDb>, nowMs: number) =>
    (await liveBoard(db.client as any, EVENT, FAN, nowMs)).runners.find((r) => r.athleteId === RUNNER)!.position;

  it('a finisher’s position is served until finish + 2 h, then null; the result stays', async () => {
    const db = seed(iso(START + 3 * H));
    expect(await positionAt(db, START + 4.9 * H)).not.toBeNull();
    expect(await positionAt(db, START + 5 * H + 1000)).toBeNull();
    const b = await liveBoard(db.client as any, EVENT, FAN, START + 5 * H + 1000);
    expect(b.runners[0]).toMatchObject({ state: 'finished', lastSec: 10_800 });
  });
  it('no finish yet: the position keeps being served inside the window', async () => {
    const db = seed(null);
    expect(await positionAt(db, START + 7 * H)).not.toBeNull();
  });
});
