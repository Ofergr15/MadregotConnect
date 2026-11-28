import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: { to: string[]; body: string; tag?: string }[] = [];
vi.mock('@/lib/push', () => ({
  subscriptionsForAthletes: async (ids: string[]) => ids.map((id) => ({ id: `s-${id}`, athlete_id: id })),
  sendPushLocalized: async (subs: { athlete_id: string }[], build: (l: string) => any) => {
    const p = build('he');
    sent.push({ to: subs.map((s) => s.athlete_id), body: p.body, tag: p.tag });
    return { sent: subs.length, byAthlete: Object.fromEntries(subs.map((s) => [s.athlete_id, 1])) };
  },
  persistNotifications: async () => {},
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('use fake db'); } }));

import { parseLiveTrackUrl, progressToSplits, trackProgress, parseTrackPoints, testLiveTrack } from '@/lib/race-live/livetrack';
import { raceLiveTick, liveBoard, storeSplits, postFinisherCard, type RaceConfig } from '@/lib/race-live/server';
import { formatClock } from '@/lib/race-live/core';

// ─── in-memory Supabase (same shape as raceLive.test.ts) ──────────────────────
const PKS: Record<string, string[]> = {
  race_live_config: ['event_id'], race_entries: ['event_id', 'athlete_id'], race_splits: ['event_id', 'athlete_id', 'point'],
  race_milestones: ['event_id', 'athlete_id', 'milestone'], race_positions: ['event_id', 'athlete_id'], race_map_viewers: ['event_id', 'athlete_id'],
};
function fakeDb(tables: Record<string, any[]>) {
  const T = (n: string) => (tables[n] ??= []);
  const pick = (row: any, path: string) => (path.includes('->>') ? row[path.split('->>')[0]]?.[path.split('->>')[1]] : row[path]);
  function q(name: string) {
    const filters: ((r: any) => boolean)[] = [];
    let op = 'select', payload: any = null, opts: any = {};
    const api: any = {
      select: () => api, limit: () => api,
      eq: (k: string, v: any) => (filters.push((r) => pick(r, k) === v), api),
      in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), api),
      update: (p: any) => ((op = 'update'), (payload = p), api),
      delete: () => ((op = 'delete'), api),
      insert: (p: any) => ((op = 'insert'), (payload = p), api),
      upsert: (p: any, o: any) => ((op = 'upsert'), (payload = p), (opts = o || {}), api),
      maybeSingle: () => run().then((r: any) => ({ data: r.data?.[0] ?? null, error: null })),
      then: (res: any, rej: any) => run().then(res, rej),
    };
    async function run() {
      const rows = T(name);
      const m = (r: any) => filters.every((f) => f(r));
      if (op === 'select') return { data: rows.filter(m), error: null };
      if (op === 'update') { rows.filter(m).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      if (op === 'delete') { tables[name] = rows.filter((r) => !m(r)); return { data: null, error: null }; }
      if (op === 'insert') { [].concat(payload).forEach((p: any) => rows.push({ id: `id-${rows.length}`, ...p })); return { data: null, error: null }; }
      const out: any[] = [];
      for (const p of [].concat(payload) as any[]) {
        const hit = rows.find((r) => PKS[name].every((k) => r[k] === p[k]));
        if (hit) { if (!opts.ignoreDuplicates) { Object.assign(hit, p); out.push(hit); } } else { rows.push({ ...p }); out.push(p); }
      }
      return { data: out, error: null };
    }
    return api;
  }
  return { from: q, tables } as any;
}

// ─── a simulated LiveTrack session: a 2:58 marathon on a straight line, a point every 30 s ──
const T0 = Date.parse('2026-12-06T07:20:00Z');
const SPEED = 42195 / (2 * 3600 + 58 * 60); // m/s → 2:58:00 by GPS
const M_PER_DEG = 111195;
function trackAt(nowMs: number, opts: { stopAtM?: number } = {}) {
  const pts: any[] = [];
  for (let t = T0; t <= nowMs; t += 30_000) {
    const d = Math.min(SPEED * ((t - T0) / 1000), opts.stopAtM ?? 42195 * 1.004); // GPS runs 0.4 % long
    if (pts.length && d === pts[pts.length - 1]._d) break; // watch stopped: no more points
    pts.push({ dateTime: new Date(t).toISOString(), position: { lat: 39.4 + d / M_PER_DEG, lon: -0.35 }, speed: SPEED, _d: d });
  }
  return pts;
}

/** Fake livetrack.garmin.com that insists on the page's CSRF double-submit, like the real one. */
function fakeGarmin(clock: { now: number }, o: { passcode?: boolean; calls?: string[] } = {}) {
  return (async (url: string, init: any) => {
    o.calls?.push(url);
    const u = new URL(url);
    if (!u.pathname.startsWith('/api/')) {
      return new Response('<html><meta name="csrf-token" content="tok123"></html>', { status: 200, headers: { 'set-cookie': 'livetrack_csrf=c00kie; Path=/' } });
    }
    if (init?.headers?.cookie !== 'livetrack_csrf=c00kie' || init?.headers?.['livetrack-csrf-token'] !== 'tok123') return new Response('', { status: 403 });
    if (u.pathname.includes('/personal-url/')) return Response.json({ garminGuid: 'guid-1', isPasscodeRequired: !!o.passcode });
    if (u.pathname.includes('/profile-sessions')) {
      if (clock.now < T0) return Response.json({ activeSessions: [], completedSessions: [] });
      return Response.json({ activeSessions: [{ sessionId: 'sess-abc12345', sessionToken: 'tokn-abc12345' }], completedSessions: [] });
    }
    if (u.pathname.includes('/track-points/common')) return Response.json({ trackPoints: trackAt(clock.now) });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

const EVENT = 'ev-valencia';
function seed(extra: Partial<Record<string, any[]>> = {}) {
  return fakeDb({
    race_live_config: [{ event_id: EVENT, source: 'manual', feed_url: null, active: true, push_enabled: true, poll_from: '2026-12-06T06:45:00Z', poll_to: '2026-12-06T13:30:00Z', poll_every_sec: 60, last_polled_at: null, fail_count: 0, replay_started_at: null, replay_speed: 1 }],
    race_entries: [
      { event_id: EVENT, athlete_id: 'r1', bib: '4100', live_opt_out: false, goal_sec: 10800, livetrack_url: 'https://livetrack.garmin.com/dana-runs' },
      { event_id: EVENT, athlete_id: 'r2', bib: '4101', live_opt_out: true, goal_sec: null, livetrack_url: 'https://livetrack.garmin.com/hidden-one' },
    ],
    athletes: ['r1', 'r2', 'fan1', 'fan2'].map((id) => ({ id, name: `שם ${id}`, role: 'runner', group_id: null, is_academy: false })),
    feature_enablements: [{ feature: 'race_live', scope_type: 'club', scope_id: '*', enabled: true }],
    athlete_follows: [{ follower_id: 'fan1', followee_id: 'r1' }],
    feed_items: [], event_group_assignments: [], race_positions: [], race_map_viewers: [{ event_id: EVENT, athlete_id: 'fan1' }],
    ...extra,
  });
}

beforeEach(() => { sent.length = 0; });

describe('LiveTrack links', () => {
  it('accepts the two link shapes a runner pastes, nothing else', () => {
    expect(parseLiveTrackUrl('https://livetrack.garmin.com/session/abc12345-def/token/XYZ987654321?x=1')).toEqual({ kind: 'session', sessionId: 'abc12345-def', token: 'XYZ987654321' });
    expect(parseLiveTrackUrl('הנה הלינק שלי livetrack.garmin.com/dana-runs')).toEqual({ kind: 'personal', name: 'dana-runs' });
    expect(parseLiveTrackUrl('https://evil.example/livetrack.garmin.com/x')).toBeNull();
    expect(parseLiveTrackUrl('https://livetrack.garmin.com.evil.io/dana')).toBeNull();
    expect(parseLiveTrackUrl('https://connect.garmin.com/modern/activity/1')).toBeNull();
  });

  it('the evening-before check: personal link ready, passcode refused, never returns points', async () => {
    const clock = { now: T0 - 12 * 3600e3 };
    expect(await testLiveTrack(parseLiveTrackUrl('livetrack.garmin.com/dana-runs')!, fakeGarmin(clock))).toEqual({ ok: true, state: 'ready' });
    expect(await testLiveTrack(parseLiveTrackUrl('livetrack.garmin.com/dana-runs')!, fakeGarmin(clock, { passcode: true }))).toEqual({ ok: false, code: 'passcode' });
  });
});

describe('track → splits', () => {
  it('interpolates course points from GPS distance; finish only once the session ends', () => {
    const pts = parseTrackPoints({ trackPoints: trackAt(T0 + 4 * 3600e3) });
    const p = trackProgress(pts);
    expect(p.distanceM).toBeGreaterThan(42195);
    const running = progressToSplits(p, { ended: false });
    expect(running.at(-1)!.point).toBe('40k');
    const half = running.find((s) => s.point === 'half')!.elapsedSec;
    expect(Math.abs(half - 21097.5 / SPEED)).toBeLessThan(5);
    expect(progressToSplits(p, { ended: true }).at(-1)!.point).toBe('finish');
  });

  it('ignores a GPS spike instead of adding kilometres', () => {
    const pts = parseTrackPoints({ trackPoints: trackAt(T0 + 600e3) });
    pts.splice(5, 0, { t: pts[4].t + 1000, lat: pts[4].lat + 0.05, lon: -0.35 }); // 5.5 km in 1 s
    expect(trackProgress(pts).distanceM).toBeLessThan(3000);
  });
});

describe('LiveTrack through the race pipeline', () => {
  it('a full simulated session: start + half to followers, finish to the club, once each; opted-out runner never read', async () => {
    const db = seed();
    const clock = { now: T0 - 30 * 60e3 };
    const calls: string[] = [];
    const fetcher = fakeGarmin(clock, { calls });
    for (clock.now = T0 - 30 * 60e3; clock.now <= T0 + 3.5 * 3600e3; clock.now += 60e3) {
      await raceLiveTick({ db, nowMs: clock.now, fetcher });
      if (clock.now % (20 * 60e3) === 0) await raceLiveTick({ db, nowMs: clock.now, fetcher, force: true }); // overlapping run
    }
    const tags = sent.map((s) => s.tag);
    expect(tags).toEqual([`race-${EVENT}-r1-start`, `race-${EVENT}-r1-half`, `race-${EVENT}-r1-finish`]);
    // r2 opted out of being SHOWN, not of hearing about teammates.
    expect(sent[2].to.sort()).toEqual(['fan1', 'fan2', 'r2']);
    expect(sent[2].body).toMatch(/^שם r1 סיים\/ה ב-2:5\d:\d\d 🎉$/);
    expect(calls.some((c) => c.includes('hidden-one'))).toBe(false);
    // Polite: every 2 minutes, not every tick (3 requests per read: page, sessions, points + user).
    const pointReads = calls.filter((c) => c.includes('track-points')).length;
    expect(pointReads).toBeLessThanOrEqual(110);
    // Stopped after the finish: no reads in the last half hour of the window.
    const n = calls.length;
    for (let i = 0; i < 10; i++) { clock.now += 120e3; await raceLiveTick({ db, nowMs: clock.now, fetcher }); }
    expect(calls.length).toBe(n);
    expect(db.tables.race_splits.every((s: any) => s.source === 'livetrack')).toBe(true);
  });

  it("staff's official chip time overrides the watch finish: card updated, no second push", async () => {
    const db = seed();
    const clock = { now: T0 + 3.5 * 3600e3 };
    await raceLiveTick({ db, nowMs: clock.now, fetcher: fakeGarmin(clock) });
    expect(sent.map((s) => s.tag)).toContain(`race-${EVENT}-r1-finish`);
    const before = sent.length;
    const official = [{ point: 'start' as const, elapsedSec: 0 }, { point: 'finish' as const, elapsedSec: 10721 }];
    const changed = await storeSplits(db, EVENT, new Map([['r1', official]]), 'manual');
    expect(changed).toEqual(['r1']);
    await postFinisherCard(db, EVENT, 'r1', official);
    expect(sent.length).toBe(before);
    expect(db.tables.feed_items).toHaveLength(1);
    expect(db.tables.feed_items[0].body).toBe(`מרתון ולנסיה · ${formatClock(10721)}`);
    // …and the watch can't take it back on the next poll.
    await storeSplits(db, EVENT, new Map([['r1', [{ point: 'finish', elapsedSec: 10600 }]]]), 'livetrack');
    expect(db.tables.race_splits.find((s: any) => s.point === 'finish').elapsed_sec).toBe(10721);
  });

  it('positions: only to members who opted in to the map; never for an opted-out runner', async () => {
    const db = seed();
    const clock = { now: T0 + 3600e3 };
    await raceLiveTick({ db, nowMs: clock.now, fetcher: fakeGarmin(clock) });
    db.tables.race_positions.push({ event_id: EVENT, athlete_id: 'r2', lat: 1, lon: 1, distance_m: 1, elapsed_sec: 1, at: 'x' });
    const fan1 = await liveBoard(db, EVENT, 'fan1', clock.now);
    expect(fan1.runners.find((r) => r.athleteId === 'r1')?.position?.distanceM).toBeGreaterThan(14000);
    expect(fan1.runners.find((r) => r.athleteId === 'r1')?.lastSource).toBe('livetrack');
    expect(fan1.runners.map((r) => r.athleteId)).not.toContain('r2');
    const fan2 = await liveBoard(db, EVENT, 'fan2', clock.now);
    expect(fan2.runners.find((r) => r.athleteId === 'r1')?.position).toBeNull();
    // The link itself is never on the board, even for its owner.
    const own = await liveBoard(db, EVENT, 'r1', clock.now);
    expect(JSON.stringify(own)).not.toContain('dana-runs');
    expect(own.runners.find((r) => r.athleteId === 'r1')?.liveTrack?.set).toBe(true);
  });

  it('a passcode link is marked and not retried; everything is deleted 24 h after the window', async () => {
    const db = seed();
    const clock = { now: T0 + 600e3 };
    await raceLiveTick({ db, nowMs: clock.now, fetcher: fakeGarmin(clock, { passcode: true }) });
    expect(db.tables.race_entries.find((e: any) => e.athlete_id === 'r1').livetrack_state).toBe('error:passcode');
    db.tables.race_positions.push({ event_id: EVENT, athlete_id: 'r1', lat: 1, lon: 1, distance_m: 1, elapsed_sec: 1, at: 'x' });
    await raceLiveTick({ db, nowMs: Date.parse('2026-12-07T13:31:00Z'), fetcher: fakeGarmin(clock) });
    expect(db.tables.race_entries.every((e: any) => e.livetrack_url === null)).toBe(true);
    expect(db.tables.race_positions).toHaveLength(0);
  });
});
