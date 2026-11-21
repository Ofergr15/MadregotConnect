import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fixture-only harness: every DB read is a fixed-delay fake. Says nothing about prod or device latency.
const D = 80;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = { denied: false, academyOnly: false, dayThrows: false, log: [] as { what: string; t0: number; t1: number }[] };
let T0 = 0;
const timed = async <T,>(what: string, f: () => T | Promise<T>): Promise<T> => {
  const t0 = performance.now() - T0; await sleep(D); const v = await f();
  state.log.push({ what, t0, t1: performance.now() - T0 }); return v;
};

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => state.denied
    ? { denied: Response.json({ error: 'Unauthorized' }, { status: 401 }), caller: null }
    : { denied: null, caller: { athleteId: 'ath-1' } },
}));
vi.mock('@/lib/plans/scope-server', () => ({
  ownPlanRowsCount: () => timed('ownCounts', () => false),
  academyOnlyReader: () => timed('academyOnly', () => state.academyOnly),
  withoutOwnRows: (rows: unknown) => rows,
}));
vi.mock('@/lib/day-session/week-merge', async (orig) => {
  const real = await orig<typeof import('@/lib/day-session/week-merge')>();
  return {
    ...real,
    daySessionWorkouts: (ws: string) => timed('daySessions', () => {
      if (state.dayThrows) throw new Error('boom');
      return [{ dayOfWeek: 3, name: 'Track', workoutKey: `day:${ws}`, steps: [{ type: 'run', distance: 5000 }] }];
    }),
  };
});
const plans = [
  { id: 'p1', week_start_date: '2026-11-22', status: 'pushed', created_at: '2026-11-20T10:00:00Z', athlete_id: null,
    parsed_workouts: { workouts: [{ dayOfWeek: 0, name: 'Easy', steps: [{ type: 'run', distance: 10000 }] }] } },
  { id: 'p0', week_start_date: '2026-11-15', status: 'pushed', created_at: '2026-11-13T10:00:00Z', athlete_id: null,
    parsed_workouts: { workouts: [{ dayOfWeek: 2, name: 'Tempo', steps: [{ type: 'run', distance: 12000 }] }] } },
];
vi.mock('@/lib/supabase/server', () => {
  const chain: any = new Proxy({}, {
    get: (_t, k) => k === 'then'
      ? (res: any, rej: any) => timed('plans', () => ({ data: plans, error: null })).then(res, rej)
      : () => chain,
  });
  return { createServerClient: () => chain };
});

const { GET: patched } = await import('@/app/api/dashboard/weekly/route');
const { GET: baseline } = await import('./fixtures/weeklyRouteBaseline');
const req = () => new Request('http://x/api/dashboard/weekly');
async function run(h: (r: Request) => Promise<Response>) {
  state.log = []; T0 = performance.now();
  const res = await h(req());
  return { ms: performance.now() - T0, status: res.status, body: await res.json(), log: state.log };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-21T19:00:00Z')); state.denied = false; state.academyOnly = false; state.dayThrows = false; });
afterEach(() => vi.useRealTimers());

describe('weekly: day sessions read in the first round trip', () => {
  for (const academyOnly of [false, true]) {
    it(`same full response and status, fewer serial hops (academyOnly=${academyOnly})`, async () => {
      state.academyOnly = academyOnly;
      const b = await run(baseline), p = await run(patched);
      expect(p.status).toBe(200); expect(p.status).toBe(b.status);
      expect(p.body).toEqual(b.body);
      const ds = p.log.find((l) => l.what === 'daySessions')!;
      expect(ds.t0).toBeLessThan(D / 2);           // started with the first Promise.all
      const rows = [];
      for (let i = 0; i < 10; i++) { const bb = await run(baseline), pp = await run(patched); rows.push({ i, baselineMs: +bb.ms.toFixed(1), patchedMs: +pp.ms.toFixed(1), equal: JSON.stringify(bb.body) === JSON.stringify(pp.body) }); }
      if (process.env.WEEKLY_TIMINGS_OUT) (await import('node:fs')).appendFileSync(process.env.WEEKLY_TIMINGS_OUT, JSON.stringify({ academyOnly, delayMsPerRead: D, rows, firstRunLog: { baseline: b.log, patched: p.log } }) + '\n');
      expect(rows.every((r) => r.equal)).toBe(true);
    });
  }
  it('saturday-evening rollover: displays next week (dates unchanged by the patch)', async () => {
    const p = await run(patched), b = await run(baseline);
    expect(p.body.currentWeekStart).toBe(b.body.currentWeekStart);
    expect(p.body.currentWeekStart).toBe('2026-11-22');
  });
  it('day-session throw: still 500 for a club reader, as before', async () => {
    state.dayThrows = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = await run(baseline), p = await run(patched);
    expect([b.status, p.status]).toEqual([500, 500]); expect(p.body).toEqual(b.body); err.mockRestore();
  });
  it('day-session throw: academy-only reader unaffected (200, identical), no unhandled rejection', async () => {
    state.dayThrows = true; state.academyOnly = true;
    const unhandled: unknown[] = []; const on = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', on);
    const b = await run(baseline), p = await run(patched);
    await sleep(20); process.off('unhandledRejection', on);
    expect([b.status, p.status]).toEqual([200, 200]); expect(p.body).toEqual(b.body); expect(unhandled).toEqual([]);
  });
  it('denied caller: 401 passed through unchanged, zero DB reads started (both versions)', async () => {
    state.denied = true;
    const b = await run(baseline); expect(b.status).toBe(401); expect(b.log).toEqual([]);
    const p = await run(patched); expect(p.status).toBe(401); expect(p.body).toEqual(b.body); expect(p.log).toEqual([]);
    await sleep(D + 20); expect(state.log).toEqual([]);          // nothing was started in the background either
  });
  it('scope: club reader gets the day session merged into the week; academy-only never gets it', async () => {
    const club = await run(patched);
    const names = (r: { body: any }) => (r.body.sessions ?? []).map((x: any) => JSON.stringify(x)).join('|');
    expect(names(club)).toContain('Track');
    state.academyOnly = true;
    const acad = await run(patched);
    expect(acad.log.some((l) => l.what === 'daySessions')).toBe(true);   // read runs in parallel now…
    expect(names(acad)).not.toContain('Track');                          // …but its payload is discarded
    expect(JSON.stringify(acad.body)).not.toContain('day:');
  });
});

