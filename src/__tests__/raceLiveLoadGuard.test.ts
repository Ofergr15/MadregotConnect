import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import {
  createBoardGuard, createWindowLimiter, withoutStalePositions,
  MAX_INFLIGHT, POSITION_MAX_AGE_MS, RUNNER_LIMIT, SHARED_TTL_MS, STALE_ON_ERROR_MAX_MS, VIEWER_LIMIT,
  raceBoardGuard, runnerPositionLimiter,
} from '@/lib/race-live/load-guard';

type B = { runners: Array<{ id: string; position: { lat: number } | null }>; who: string };
const board = (who: string, pos = true): B => ({ who, runners: [{ id: 'r1', position: pos ? { lat: 39.4 } : null }] });

describe('createWindowLimiter', () => {
  it('allows `limit` per window, then refuses until the window resets', () => {
    const l = createWindowLimiter(3, 60_000);
    expect([0, 1, 2, 3].map((i) => l.allow('k', 1000 + i))).toEqual([true, true, true, false]);
    expect(l.retryAfterSec('k', 1004)).toBe(60);
    expect(l.allow('k', 61_000)).toBe(true);
  });
  it('keys are independent; a clock that went backwards starts a new window', () => {
    const l = createWindowLimiter(1, 60_000);
    expect(l.allow('a', 5000)).toBe(true);
    expect(l.allow('b', 5000)).toBe(true);
    expect(l.allow('a', 5001)).toBe(false);
    expect(l.allow('a', 1000)).toBe(true);
  });
});

describe('withoutStalePositions', () => {
  it('keeps positions while fresh, drops them once older than the position cap', () => {
    expect(withoutStalePositions(board('x'), POSITION_MAX_AGE_MS).runners[0].position).not.toBeNull();
    expect(withoutStalePositions(board('x'), POSITION_MAX_AGE_MS + 1).runners[0].position).toBeNull();
  });
});

describe('createBoardGuard', () => {
  let t: number;
  let g: ReturnType<typeof createBoardGuard<B>>;
  const own = vi.fn(async () => board('own'));
  const shared = vi.fn(async () => board('shared', false));
  beforeEach(() => {
    t = 1_000_000;
    g = createBoardGuard<B>({ now: () => t });
    own.mockClear(); shared.mockClear();
    own.mockImplementation(async () => board('own'));
  });

  it('normal load: every call is a fresh build of the viewer’s own board', async () => {
    const r = await g.board('v1', 'e', own, shared);
    expect(r).toMatchObject({ kind: 'fresh', board: { who: 'own' } });
    expect(shared).not.toHaveBeenCalled();
  });

  it('over the per-viewer limit: the viewer’s last board comes back (200), no DB build', async () => {
    for (let i = 0; i < VIEWER_LIMIT; i++) await g.board('v1', 'e', own, shared);
    t += 5_000;
    const r = await g.board('v1', 'e', own, shared);
    expect(r).toMatchObject({ kind: 'cached', reason: 'viewer-limit', board: { who: 'own' } });
    expect(own).toHaveBeenCalledTimes(VIEWER_LIMIT);
    // Another viewer is unaffected.
    expect((await g.board('v2', 'e', own, shared)).kind).toBe('fresh');
  });

  it('over the limit with nothing cached → limited with a Retry-After', async () => {
    own.mockRejectedValue(new Error('db down'));
    for (let i = 0; i < VIEWER_LIMIT; i++) await g.board('v1', 'e', own, shared);
    const r = await g.board('v1', 'e', own, shared);
    expect(r).toMatchObject({ kind: 'limited' });
    expect((r as any).retryAfterSec).toBeGreaterThan(0);
  });

  it('busy instance (too many in flight): served from ONE shared snapshot built once', async () => {
    const gates: Array<() => void> = [];
    own.mockImplementation(() => new Promise<B>((res) => gates.push(() => res(board('own')))));
    const slow = Array.from({ length: MAX_INFLIGHT }, (_, i) => g.board(`slow${i}`, 'e', own, shared));
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => g.board(`fan${i}`, 'e', own, shared)));
    expect(rs.every((r) => r.kind === 'cached' && r.reason === 'busy' && r.board.who === 'shared')).toBe(true);
    expect(shared).toHaveBeenCalledTimes(1);
    gates.forEach((go) => go());
    await Promise.all(slow);
    own.mockImplementation(async () => board('own'));
    // Load gone: back to fresh builds.
    expect((await g.board('fan0', 'e', own, shared)).kind).toBe('fresh');
  });

  it('the shared snapshot is rebuilt after its TTL, not before', async () => {
    const hold: Array<() => void> = [];
    own.mockImplementation(() => new Promise<B>((res) => hold.push(() => res(board('own')))));
    const slow = Array.from({ length: MAX_INFLIGHT }, (_, i) => g.board(`s${i}`, 'e', own, shared));
    await g.board('a', 'e', own, shared);
    t += SHARED_TTL_MS - 1;
    await g.board('b', 'e', own, shared);
    expect(shared).toHaveBeenCalledTimes(1);
    t += 2;
    await g.board('c', 'e', own, shared);
    expect(shared).toHaveBeenCalledTimes(2);
    hold.forEach((go) => go());
    await Promise.all(slow);
  });

  it('a failing DB answers from the last snapshot (degraded: error), and fails only with none', async () => {
    await g.board('v1', 'e', own, shared);
    own.mockRejectedValue(new Error('db down'));
    t += 90_000;
    const r = await g.board('v1', 'e', own, shared);
    expect(r).toMatchObject({ kind: 'cached', reason: 'error' });
    // Older than the position cap: positions are gone from what is served.
    expect((r as any).board.runners[0].position).toBeNull();
    t += STALE_ON_ERROR_MAX_MS;
    expect((await g.board('v1', 'e', own, shared)).kind).toBe('failed');
    expect((await g.board('new', 'e', own, shared)).kind).toBe('failed');
  });

  it('a cached board of one viewer is never served to another', async () => {
    await g.board('v1', 'e', own, shared);
    own.mockRejectedValue(new Error('db down'));
    expect((await g.board('v2', 'e', own, shared)).kind).toBe('failed');
  });
});

// ─── the routes ────────────────────────────────────────────────────────────────

const EVENT = uid();
const RUNNER = uid();
const FAN = uid();
const HIDDEN = uid();

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async () => true }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { POST } = await import('@/app/api/race-live/[eventId]/position/route');
const { GET: BOARD } = await import('@/app/api/race-live/[eventId]/route');

const START = Date.parse('2026-12-06T07:15:00Z');
const as = (athleteId: string | null) =>
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: false, isSuperUser: false, role: 'runner', email: 'x' } });
const ctx = { params: Promise.resolve({ eventId: EVENT }) };
const post = (nowMs: number, distanceM: number) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ lat: 39.47, lon: -0.37, distanceM, elapsedSec: 60, at: new Date(nowMs).toISOString() }) }) as any, ctx);
const get = () => BOARD(new Request('http://x') as any, ctx);

describe('routes under the guard', () => {
  beforeEach(() => {
    raceBoardGuard.reset();
    runnerPositionLimiter.reset();
    vi.useFakeTimers();
    vi.setSystemTime(START);
    db = createMemoryDb({
      schema: {
        race_live_config: ['event_id', 'source', 'active', 'last_polled_at', 'poll_from', 'poll_to'],
        race_entries: ['event_id', 'athlete_id', 'bib', 'live_opt_out', 'goal_sec', 'livetrack_url', 'livetrack_state'],
        race_splits: ['event_id', 'athlete_id', 'point', 'elapsed_sec', 'source'],
        race_positions: ['event_id', 'athlete_id', 'lat', 'lon', 'distance_m', 'elapsed_sec', 'at'],
        race_map_viewers: ['event_id', 'athlete_id'],
        athletes: ['id', 'name', 'avatar_url'],
        event_group_assignments: ['event_id', 'athlete_id', 'group_id'],
      },
      unique: { race_positions: [['event_id', 'athlete_id']], race_map_viewers: [['event_id', 'athlete_id']] },
    });
    db.tables.race_live_config.push({ event_id: EVENT, source: 'manual', active: true, last_polled_at: null, poll_from: '2026-12-06T06:45:00Z', poll_to: '2026-12-06T13:30:00Z' });
    db.tables.race_entries.push(
      { event_id: EVENT, athlete_id: RUNNER, bib: '1', live_opt_out: false, goal_sec: 10800 },
      { event_id: EVENT, athlete_id: HIDDEN, bib: '2', live_opt_out: true, goal_sec: 10800 },
    );
    db.tables.athletes.push({ id: RUNNER, name: 'Runner', avatar_url: null }, { id: FAN, name: 'Fan', avatar_url: null }, { id: HIDDEN, name: 'Hidden', avatar_url: null });
    db.tables.race_map_viewers.push({ event_id: EVENT, athlete_id: FAN });
  });

  it('a phone retry storm is cut at the per-runner limit with a 429 + Retry-After, before the DB', async () => {
    as(RUNNER);
    const statuses: number[] = [];
    for (let i = 0; i < RUNNER_LIMIT + 3; i++) {
      vi.setSystemTime(START + i * 1000);
      statuses.push((await post(START + i * 1000, 100 + i)).status);
    }
    const limited = statuses.slice(RUNNER_LIMIT);
    expect(limited.every((s) => s === 429)).toBe(true);
    const res = await post(START + 20_000, 500);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ error: 'rate-limited' });
    // The next minute is open again.
    vi.setSystemTime(START + 61_000);
    expect((await post(START + 61_000, 1000)).status).toBe(200);
  });

  it('a normal 15 s phone cadence never meets the limiter', async () => {
    as(RUNNER);
    for (let s = 0; s <= 600; s += 15) {
      vi.setSystemTime(START + s * 1000);
      expect((await post(START + s * 1000, 100 + s * 3)).status).toBe(200);
    }
  });

  it('a viewer polling far too fast gets their own board back marked degraded, never a 500', async () => {
    as(FAN);
    db.tables.race_positions.push({ event_id: EVENT, athlete_id: RUNNER, lat: 39.47, lon: -0.37, distance_m: 5000, elapsed_sec: 1500, at: new Date(START).toISOString() });
    for (let i = 0; i < VIEWER_LIMIT; i++) expect((await get()).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enabled: true, degraded: 'viewer-limit' });
    expect(body.snapshotAt).toBe(new Date(START).toISOString());
    expect(body.runners.find((r: any) => r.athleteId === RUNNER).position).toMatchObject({ distanceM: 5000 });
  });

  it('the DB failing mid-race: the last board is served instead of a 500; no snapshot → 500', async () => {
    as(FAN);
    expect((await get()).status).toBe(200);
    const spy = vi.spyOn(db.client, 'from').mockImplementation(() => { throw new Error('connection reset'); });
    vi.setSystemTime(START + 90_000);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe('error');
    // 90 s old: no positions are vouched for from a cache that old.
    expect(body.runners.every((r: any) => r.position === null)).toBe(true);
    as(RUNNER);
    expect((await get()).status).toBe(500);
    spy.mockRestore();
  });

  it('the shared busy snapshot has no opted-out runner and no positions', async () => {
    const g = createBoardGuard<any>({ now: () => START });
    const { liveBoard } = await import('@/lib/race-live/server');
    db.tables.race_positions.push({ event_id: EVENT, athlete_id: RUNNER, lat: 39.47, lon: -0.37, distance_m: 5000, elapsed_sec: 1500, at: new Date(START).toISOString() });
    const hold: Array<() => void> = [];
    const slow = Array.from({ length: MAX_INFLIGHT }, (_, i) => g.board(`s${i}`, EVENT, () => new Promise((res) => hold.push(() => res({ runners: [] }))), async () => ({ runners: [] })));
    const r = await g.board(FAN, EVENT, () => liveBoard(db.client as any, EVENT, FAN, START), () => liveBoard(db.client as any, EVENT, null, START));
    expect(r.kind).toBe('cached');
    const b = (r as any).board;
    expect(b.runners.map((x: any) => x.athleteId)).toEqual([RUNNER]);
    expect(b.runners[0].position).toBeNull();
    expect(b.mapOptIn).toBe(false);
    hold.forEach((go) => go());
    await Promise.all(slow);
  });
});
