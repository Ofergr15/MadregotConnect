import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Coverage sweep (task 14): server helpers that had 0% line coverage, against a recorded fake DB. */

type Call = { table: string; ops: Array<[string, unknown[]]> };
/** A PostgREST-ish builder: every method chains, awaiting it resolves `result(call)`. */
function fakeDb(result: (c: Call) => unknown) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const b: any = new Proxy({}, {
      get(_t, k: string) {
        if (k === 'then') return (ok: any, bad: any) => Promise.resolve(result(call)).then(ok, bad);
        if (k === 'maybeSingle' || k === 'single') return () => Promise.resolve(result({ ...call, ops: [...call.ops, [k, []]] }));
        return (...args: unknown[]) => { call.ops.push([k, args]); return b; };
      },
    });
    return b;
  };
  return { db: { from } as any, calls };
}
const op = (c: Call, name: string) => c.ops.filter(([k]) => k === name).map(([, a]) => a);

describe('shoes checkShoeAlert', () => {
  const notifyAthlete = vi.fn(async (_x: unknown) => undefined);
  let shoe: any; let acts: any[]; let fake: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    vi.resetModules(); notifyAthlete.mockClear();
    fake = fakeDb((c) => c.table === 'shoes' && op(c, 'maybeSingle').length ? { data: shoe } : c.table === 'athlete_activities' ? { data: acts } : { data: null, error: null });
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => fake.db }));
    vi.doMock('@/lib/push', () => ({ notifyAthlete: (x: unknown) => notifyAthlete(x) }));
  });
  const run = async () => (await import('@/lib/shoes')).checkShoeAlert('s1');
  const updates = () => fake.calls.filter((c) => c.table === 'shoes').flatMap((c) => op(c, 'update')).map((a) => Object.keys(a[0] as object)[0]);

  it('alerts once when the limit is reached', async () => {
    shoe = { id: 's1', athlete_id: 'a1', name: 'Pegasus', distance_limit_km: 600, alert_before_km: 50 };
    acts = [{ distance: 400_000 }, { distance: 210_000 }];
    await run();
    expect(updates()).toEqual(['alerted_over_at']);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect((notifyAthlete.mock.calls[0][0] as any).kind).toBe('shoe_limit');
  });
  it('warns when within alert_before_km (default 50)', async () => {
    shoe = { id: 's1', athlete_id: 'a1', name: 'X', distance_limit_km: 600, alert_before_km: null };
    acts = [{ distance: 560_000 }];
    await run();
    expect(updates()).toEqual(['alerted_near_at']);
  });
  it('stays quiet for a retired shoe, no limit, below threshold, or already alerted', async () => {
    for (const s of [
      { retired: true, distance_limit_km: 100 },
      { distance_limit_km: null },
      { distance_limit_km: 600 },
      { distance_limit_km: 600, alerted_over_at: 'x', alerted_near_at: 'x' },
    ]) {
      shoe = { id: 's1', athlete_id: 'a1', ...s }; acts = s.alerted_over_at ? [{ distance: 700_000 }] : [{ distance: 10_000 }];
      await run();
    }
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
  it('never throws when the DB does', async () => {
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('down'); } }));
    await expect(run()).resolves.toBeUndefined();
  });
});

describe('races recomputeRaceMatches', () => {
  it('auto-matches same-day race runs, skips manual ones, replaces old auto rows', async () => {
    const { recomputeRaceMatches } = await import('@/lib/races/match-athlete-races');
    const { db, calls } = fakeDb((c) => {
      if (c.table === 'athlete_activities') return { data: [
        { id: 'r1', start_time: '2026-12-06T08:15:00' },
        { id: 'r2', start_time: '2026-12-07T08:15:00' },
        { id: 'r3', start_time: '2026-12-06T18:00:00' },
      ], error: null };
      if (c.table === 'events') return { data: [{ id: 'e1', name: 'Valencia', date: '2026-12-06' }], error: null };
      if (c.table === 'race_matches' && op(c, 'select').length) return { data: [{ activity_id: 'r3' }], error: null };
      return { error: null };
    });
    expect(await recomputeRaceMatches(db, 'a1')).toEqual({ matched: 1 });
    const rm = calls.filter((c) => c.table === 'race_matches');
    expect(rm.some((c) => op(c, 'delete').length && op(c, 'eq').some((a) => a[1] === 'auto'))).toBe(true);
    const ins = rm.flatMap((c) => op(c, 'insert'))[0][0] as any[];
    expect(ins).toEqual([expect.objectContaining({ activity_id: 'r1', event_id: 'e1', match_method: 'auto', is_race: true })]);
  });
  it('inserts nothing when no run falls on a race day, and surfaces read errors', async () => {
    const { recomputeRaceMatches } = await import('@/lib/races/match-athlete-races');
    const quiet = fakeDb((c) => c.table === 'events' ? { data: [], error: null } : { data: [{ id: 'r', start_time: '2026-01-01T07:00:00' }], error: null });
    expect(await recomputeRaceMatches(quiet.db, 'a')).toEqual({ matched: 0 });
    expect(quiet.calls.some((c) => op(c, 'insert').length)).toBe(false);
    const broken = fakeDb((c) => c.table === 'events' ? { data: null, error: new Error('boom') } : { data: [], error: null });
    await expect(recomputeRaceMatches(broken.db, 'a')).rejects.toThrow('boom');
  });
});

describe('release-server', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('mainHead returns a valid sha and null for garbage or a network error', async () => {
    const m = await import('@/lib/release-server');
    const sha = 'a'.repeat(40);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`${sha}\n`)));
    expect(await m.mainHead()).toBe(sha);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>')));
    expect(await m.mainHead()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await m.mainHead()).toBeNull();
  });
  it('notesAt accepts only an array', async () => {
    const m = await import('@/lib/release-server');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ id: 'n1' }])));
    expect(await m.notesAt('abc')).toEqual([{ id: 'n1' }]);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ no: 1 })));
    expect(await m.notesAt('abc')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
    expect(await m.notesAt('abc')).toBeNull();
  });
  it('markShipped only on production, once per sha, closing approvals up to the deployed one', async () => {
    const m = await import('@/lib/release-server');
    const { RELEASE_BRANCH } = await import('@/lib/release-notes');
    const { db, calls } = fakeDb((c) => op(c, 'maybeSingle').length ? { data: { id: 7 } } : { error: null });
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'sha1');
    await m.markShipped(db);
    expect(calls).toHaveLength(0);
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', RELEASE_BRANCH);
    expect(m.onProduction()).toBe(true);
    expect(m.deployedSha()).toBe('sha1');
    await m.markShipped(db);
    await m.markShipped(db);
    const upd = calls.filter((c) => op(c, 'update').length);
    expect(upd).toHaveLength(1);
    expect(op(upd[0], 'lte')[0]).toEqual(['id', 7]);
  });
  it('activeApproval returns the newest unshipped row, null on error', async () => {
    const m = await import('@/lib/release-server');
    expect(await m.activeApproval(fakeDb(() => ({ data: { id: 3, sha: 's' }, error: null })).db)).toEqual({ id: 3, sha: 's' });
    expect(await m.activeApproval(fakeDb(() => ({ data: null, error: { message: 'x' } })).db)).toBeNull();
  });
});

describe('core-runner-add', () => {
  beforeEach(() => vi.resetModules());

  it('welcomeCopy is gendered and uses the first name only', async () => {
    const { welcomeCopy } = await import('@/lib/core-runner-add');
    expect(welcomeCopy('Dana Cohen', 'female', 4).title).toContain('ברוכה הבאה');
    expect(welcomeCopy('Dana Cohen', 'female', 4).title).toContain(', Dana');
    expect(welcomeCopy(null, 'male', 2).title).not.toContain(',');
    expect(welcomeCopy('A', null, 3).body).toMatch(/^3 /);
  });
  it('addPreview sums only runs from the last 8 weeks and reports no podium without an open round', async () => {
    vi.doMock('@/lib/podium/server', () => ({ listRounds: async () => [] }));
    const { addPreview } = await import('@/lib/core-runner-add');
    const { db } = fakeDb((c) => {
      if (c.table === 'athletes') return { data: { name: 'Noa', gender: 'female', created_at: '2025-01-01', groups: { name: 'G3' } } };
      if (c.table === 'club_perks') return { count: 5 };
      if (c.table === 'athlete_activities') return { data: [
        { distance: 10_400, workout_title: 'Intervals', activity_type: 'running' },
        { distance: 5_000, workout_title: null, activity_type: null },
        { distance: 30_000, workout_title: null, activity_type: 'cycling' },
      ] };
      return { data: null };
    });
    const p = await addPreview(db, 'a1');
    expect(p.person).toMatchObject({ name: 'Noa', group: 'G3', runs8: 2, km8: 15, quality8: 1 });
    expect(p.welcome.body).toMatch(/^5 /);
    expect(p.podium).toBeNull();
  });
});

describe('move/state', () => {
  let store: Record<string, string>; let fake: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    vi.resetModules(); vi.unstubAllEnvs(); store = {};
    fake = fakeDb((c) => {
      const up = op(c, 'upsert')[0];
      if (up) { const r = up[0] as { key: string; value: string }; store[r.key] = r.value; return { error: null }; }
      const key = op(c, 'eq')[0]?.[1] as string;
      return { data: store[key] ? { value: store[key] } : null };
    });
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => fake.db }));
  });

  it('knows which Supabase project it is connected to', async () => {
    const m = await import('@/lib/move/state');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${m.OLD_REF}.supabase.co`);
    expect(m.connectedRef()).toBe(m.OLD_REF);
    expect(m.onNewProject()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://newref.supabase.co');
    expect(m.onNewProject()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not a url');
    expect(m.connectedHost()).toBe('');
    expect(m.onNewProject()).toBe(false);
    vi.stubEnv('VERCEL_REGION', 'fra1');
    expect(m.baseInfo()).toMatchObject({ functionRegion: 'fra1', onNew: false });
  });
  it('status defaults to idle, the log appends and keeps the last 80', async () => {
    const m = await import('@/lib/move/state');
    expect(await m.readMoveStatus()).toEqual({ phase: 'idle', log: [] });
    await m.appendMoveLog('start', { phase: 'frozen' });
    for (let i = 0; i < 85; i++) await m.appendMoveLog(`step ${i}`, {}, i % 2 === 0);
    const s = await m.readMoveStatus();
    expect(s.phase).toBe('frozen');
    expect(s.log).toHaveLength(80);
    expect(s.log.at(-1)).toMatchObject({ text: 'step 84', ok: true });
  });
  it('snapshot round-trips and unreadable JSON reads as missing', async () => {
    const m = await import('@/lib/move/state');
    expect(await m.readMoveSnapshot()).toBeNull();
    await m.writeMoveSnapshot({ at: 't', source: 'old', tables: { a: 1 }, buckets: {}, authUsers: 1, strava: 0, garmin: 0, pushSubs: 0 });
    expect((await m.readMoveSnapshot())?.tables).toEqual({ a: 1 });
    store.move_snapshot = '{oops';
    expect(await m.readMoveSnapshot()).toBeNull();
  });
});
