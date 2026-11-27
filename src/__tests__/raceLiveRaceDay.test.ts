import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { mergePhonePosition, parsePhonePosition, phoneWriteAllowed, raceWindowOpen } from '@/lib/race-live/phone';

/**
 * Valencia 2026-12-06 hardening (~25 runners sharing every 10-20 s for 4 h, ~50 viewers):
 * the ingest route against a real-shaped table, resume after a restarted phone session,
 * and who may read a position and when.
 */

const EVENT = uid();
const RUNNER = uid();
const FAN = uid();
const OUTSIDER = uid();

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const flags = new Set<string>();
vi.mock('@/lib/features/server', () => ({
  isFeatureEnabled: async (f: string, id: string | null) => flags.has(`${f}:${id}`),
}));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { POST, DELETE } = await import('@/app/api/race-live/[eventId]/position/route');
const { GET: BOARD } = await import('@/app/api/race-live/[eventId]/route');
const { liveBoard } = await import('@/lib/race-live/server');

const START = Date.parse('2026-12-06T07:15:00Z');
const as = (athleteId: string | null, denied: Response | null = null) =>
  resolveVerifiedCaller.mockResolvedValue({ denied, caller: { athleteId, isStaff: false, isSuperUser: false, role: 'runner', email: 'x' } });
const ctx = { params: Promise.resolve({ eventId: EVENT }) };
const post = (body: Record<string, unknown>) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as any, ctx);
const point = (nowMs: number, distanceM: number, elapsedSec: number, extra: Record<string, unknown> = {}) =>
  ({ lat: 39.47, lon: -0.37, distanceM, elapsedSec, at: new Date(nowMs).toISOString(), ...extra });

function seed(window: { from: string; to: string } = { from: '2026-12-06T06:45:00Z', to: '2026-12-06T13:30:00Z' }) {
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
  db.tables.race_live_config.push({ event_id: EVENT, source: 'manual', active: true, last_polled_at: null, poll_from: window.from, poll_to: window.to });
  db.tables.race_entries.push({ event_id: EVENT, athlete_id: RUNNER, bib: '1234', live_opt_out: false, goal_sec: 10800 });
  db.tables.athletes.push({ id: RUNNER, name: 'Runner', avatar_url: null }, { id: FAN, name: 'Fan', avatar_url: null });
  db.tables.race_map_viewers.push({ event_id: EVENT, athlete_id: FAN });
  flags.clear();
  flags.add(`race_live_phone:${RUNNER}`);
  flags.add(`race_live:${FAN}`);
}

beforeEach(() => {
  seed();
  vi.useFakeTimers();
  vi.setSystemTime(START);
  as(RUNNER);
});

describe('ingest', () => {
  it('a full 4 h race at one point every 15 s: every point lands, distance only grows', async () => {
    let accepted = 0;
    for (let s = 0; s <= 4 * 3600; s += 15) {
      vi.setSystemTime(START + s * 1000);
      const res = await post(point(START + s * 1000, Math.round(s * 2.93), s));
      if (res.status === 200) accepted++;
    }
    expect(accepted).toBe(4 * 240 + 1);
    expect(db.tables.race_positions).toHaveLength(1);
    expect(db.tables.race_positions[0].distance_m).toBe(Math.round(4 * 3600 * 2.93));
  });

  it('a retry inside 8 s is a 429, never a 403', async () => {
    expect((await post(point(START, 1000, 300))).status).toBe(200);
    vi.setSystemTime(START + 5_000);
    expect((await post(point(START + 5_000, 1015, 305))).status).toBe(429);
  });

  it('resume:true after a restarted phone session continues the same track (no 403)', async () => {
    await post(point(START, 15000, 4400));
    // Phone rebooted at 15 km; the app re-shares 3 minutes later and its counters start at 0.
    const t = START + 180_000 + 60_000;
    vi.setSystemTime(t);
    expect((await post(point(t, 250, 60))).status).toBe(403); // without the flag: a new session, refused
    const res = await post(point(t, 250, 60, { resume: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ resumed: true, baseDistanceM: 15000, distanceM: 15250 });
    expect(db.tables.race_positions).toHaveLength(1);
    expect(db.tables.race_positions[0]).toMatchObject({ distance_m: 15250, elapsed_sec: 4400 + 240 });
    // From now on the phone sends cumulative numbers; no further resume needed.
    vi.setSystemTime(t + 60_000);
    expect((await post(point(t + 60_000, 15000 + 250 + 170, 60 + 60))).status).toBe(200);
  });

  it('stop then share again (DELETE, then POST from 0) is accepted', async () => {
    await post(point(START, 15000, 4400));
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }) as any, ctx)).status).toBe(200);
    vi.setSystemTime(START + 60_000);
    expect((await post(point(START + 60_000, 100, 30))).status).toBe(200);
  });

  it.each([
    ['before the window', '2026-12-06T08:00:00Z', '2026-12-06T13:30:00Z', 409],
    ['after the window', '2026-12-06T05:00:00Z', '2026-12-06T07:00:00Z', 409],
  ])('%s → %i', async (_n, from, to, status) => {
    seed({ from, to });
    expect((await post(point(START, 100, 30))).status).toBe(status);
    expect(db.tables.race_positions).toHaveLength(0);
  });

  it('an opted-out runner, or a member not on the board, cannot write', async () => {
    db.tables.race_entries[0].live_opt_out = true;
    expect((await post(point(START, 100, 30))).status).toBe(403);
    as(OUTSIDER);
    flags.add(`race_live_phone:${OUTSIDER}`);
    expect((await post(point(START, 100, 30))).status).toBe(403);
    expect(db.tables.race_positions).toHaveLength(0);
  });

  it('an unverified caller is refused before any query', async () => {
    as(null, new Response('{}', { status: 401 }));
    expect((await post(point(START, 100, 30))).status).toBe(401);
    expect(db.log).toHaveLength(0);
  });
});

describe('who reads a position, and when', () => {
  beforeEach(async () => {
    await post(point(START, 5000, 1500));
  });

  it('a member with the flag who opted in to the map sees it during the window', async () => {
    as(FAN);
    const body = await (await BOARD(new Request('http://x') as any, ctx)).json();
    expect(body.runners[0].position).toMatchObject({ distanceM: 5000 });
  });

  it('a member who did not opt in to the map sees no position', async () => {
    db.tables.race_map_viewers.length = 0;
    as(FAN);
    const body = await (await BOARD(new Request('http://x') as any, ctx)).json();
    expect(body.runners[0].position).toBeNull();
  });

  it('a member without race_live gets no board at all', async () => {
    as(OUTSIDER);
    expect(await (await BOARD(new Request('http://x') as any, ctx)).json()).toEqual({ enabled: false });
  });

  it('no session → the gate refuses, nothing is public', async () => {
    as(null, new Response('{}', { status: 401 }));
    expect((await BOARD(new Request('http://x') as any, ctx)).status).toBe(401);
  });

  it('after the window closes the position is hidden, even before the 24 h purge', async () => {
    const after = Date.parse('2026-12-06T14:00:00Z');
    const board = await liveBoard(db.client as any, EVENT, FAN, after);
    expect(db.tables.race_positions).toHaveLength(1);
    expect(board.runners[0].position).toBeNull();
  });

  it('an opted-out runner\'s position is never shown', async () => {
    db.tables.race_entries[0].live_opt_out = true;
    const board = await liveBoard(db.client as any, EVENT, FAN, START);
    expect(board.runners.find(r => r.athleteId === RUNNER)).toBeUndefined();
  });
});

describe('pure rules', () => {
  it('raceWindowOpen', () => {
    const cfg = { active: true, poll_from: '2026-12-06T06:45:00Z', poll_to: '2026-12-06T13:30:00Z' };
    expect(raceWindowOpen(cfg, START)).toBe(true);
    expect(raceWindowOpen({ ...cfg, active: false }, START)).toBe(false);
    expect(raceWindowOpen(cfg, Date.parse('2026-12-06T13:31:00Z'))).toBe(false);
    expect(raceWindowOpen(null, START)).toBe(false);
  });

  it('parse keeps resume only when it is literally true', () => {
    expect(parsePhonePosition(point(START, 1, 1, { resume: true }), START)?.resume).toBe(true);
    expect(parsePhonePosition(point(START, 1, 1, { resume: 'yes' }), START)?.resume).toBeUndefined();
  });

  it('resume does not bypass the window, opt-out or rate limit', () => {
    const next = parsePhonePosition(point(START, 100, 30, { resume: true }), START)!;
    const cfg = { active: true, poll_from: null, poll_to: null };
    expect(phoneWriteAllowed({ nowMs: START, cfg: { ...cfg, active: false }, entry: { live_opt_out: false }, prev: null, next })).toBe('out-of-window');
    expect(phoneWriteAllowed({ nowMs: START, cfg, entry: { live_opt_out: true }, prev: null, next })).toBe('opted-out');
    expect(phoneWriteAllowed({ nowMs: START, cfg, entry: { live_opt_out: false }, prev: { distance_m: 9000, at: new Date(START - 5000).toISOString() }, next })).toBe('too-soon');
  });

  it('merge without a drop is the phone\'s own numbers', () => {
    expect(mergePhonePosition({ distance_m: 1000, elapsed_sec: 300, at: new Date(START - 60_000).toISOString() },
      parsePhonePosition(point(START, 1200, 360, { resume: true }), START)!)).toMatchObject({ distance_m: 1200, elapsed_sec: 360, baseDistanceM: 0 });
  });
});
