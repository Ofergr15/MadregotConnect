import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';

/**
 * The two read-only "me" routes for the native app:
 *   GET /api/me/plan-scores       — the feed's plan score, per run, for one plan week
 *   GET /api/me/progress-summary  — the profile progress cards' numbers
 * Pinned: anonymous → 401; a hidden pace hides the score; a week with no plan
 * grades nothing (through the REAL feed loader); the activity reads page past 1000.
 */

const ATHLETE = 'aaaaaaaa-0000-0000-0000-000000000001';
const me = { email: 'me@x', isSuperUser: false, canApprove: false, isStaff: false, athleteId: ATHLETE, role: 'runner', isCoreRunner: false };

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));
vi.mock('@/lib/academy/settings-server', () => ({
  loadAcademySettings: () => Promise.resolve(DEFAULT_ACADEMY_SETTINGS),
}));

// null = run the real loader; otherwise a canned verdict map.
let cannedVerdicts: Map<string, unknown> | null = null;
const loaderCalls: unknown[][] = [];
vi.mock('@/lib/feed/plan-verdicts', async (orig) => {
  const real = await orig<typeof import('@/lib/feed/plan-verdicts')>();
  return {
    ...real,
    loadFeedPlanVerdicts: (...args: Parameters<typeof real.loadFeedPlanVerdicts>) => {
      loaderCalls.push(args);
      return cannedVerdicts ? Promise.resolve(cannedVerdicts) : real.loadFeedPlanVerdicts(...args);
    },
  };
});

type Op = { table: string; calls: Array<[string, unknown[]]> };
let ops: Op[] = [];
let respond: (op: Op) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

function chainFor(record: Op): unknown {
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(respond(record)).then(resolve, reject);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => { const { data, error } = respond(record); return Promise.resolve({ data: (data || [])[0] ?? null, error }); };
      }
      return (...args: unknown[]) => { record.calls.push([prop as string, args]); return chainFor(record); };
    },
  });
}
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) { const record: Op = { table, calls: [] }; ops.push(record); return chainFor(record); },
    rpc() { return Promise.resolve({ data: null, error: { message: 'no rpc' } }); },
  }),
}));

const planScores = (await import('@/app/api/me/plan-scores/route')).GET;
const progress = (await import('@/app/api/me/progress-summary/route')).GET;

const anon = () => ({ denied: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }), caller: { ...me, athleteId: null } });
const run = (id: string, start: string) => ({
  id, athlete_id: ATHLETE, activity_type: 'running', start_time: start, distance: 10000, duration: 3000,
  moving_duration: 3000, average_pace: 300, laps: null,
});
const selectOf = (op: Op) => String(op.calls.find(c => c[0] === 'select')?.[1][0] ?? '');

beforeEach(() => {
  ops = []; loaderCalls.length = 0; cannedVerdicts = null;
  resolveVerifiedCaller.mockReset().mockResolvedValue({ denied: null, caller: me });
  respond = () => ({ data: [], error: null });
});

describe('GET /api/me/plan-scores', () => {
  const req = (q = '?weekStart=2026-09-06') => new Request(`http://x/api/me/plan-scores${q}`, { headers: { authorization: 'Bearer t' } });

  it('401s an anonymous caller without touching the database', async () => {
    resolveVerifiedCaller.mockResolvedValue(anon());
    const res = await planScores(req());
    expect(res.status).toBe(401);
    expect(ops).toHaveLength(0);
  });

  it('reads only the caller\'s runs in the Sunday plan week, and grades through the feed loader as self', async () => {
    respond = (op) => ({ data: op.table === 'athlete_activities' ? [run('r1', '2026-09-08T06:00:00')] : [], error: null });
    cannedVerdicts = new Map([['r1', { activityId: 'r1', status: 'graded', score: 87, direction: 'too_slow', workoutName: 'x' }]]);
    // A Wednesday normalises to its Sunday.
    const body = await (await planScores(req('?weekStart=2026-09-09'))).json();
    expect(body.weekStart).toBe('2026-09-06');
    expect(body.scores).toEqual([{ activityId: 'r1', score: 87, paceStatus: 'too_slow' }]);
    const acts = ops.find(o => o.table === 'athlete_activities')!;
    expect(acts.calls).toContainEqual(['eq', ['athlete_id', ATHLETE]]);
    expect(acts.calls).toContainEqual(['gte', ['start_time', '2026-09-06T00:00:00']]);
    expect(acts.calls).toContainEqual(['lt', ['start_time', '2026-09-13T00:00:00']]);
    expect(loaderCalls[0][2]).toEqual({ athleteId: ATHLETE, isStaff: false });
  });

  it('masks the score of a run whose pace is hidden', async () => {
    respond = (op) => {
      if (op.table === 'athlete_activities') return { data: [run('r1', '2026-09-08T06:00:00'), run('r2', '2026-09-09T06:00:00')], error: null };
      if (op.table === 'feed_items') return { data: [{ activity_id: 'r1', payload: { hiddenFields: ['pace'] } }], error: null };
      return { data: [], error: null };
    };
    cannedVerdicts = new Map([
      ['r1', { activityId: 'r1', status: 'graded', score: 91, direction: 'on_target', workoutName: 'x' }],
      ['r2', { activityId: 'r2', status: 'graded', score: 64, direction: 'too_fast', workoutName: 'y' }],
    ]);
    const body = await (await planScores(req())).json();
    expect(body.scores).toEqual([
      { activityId: 'r1', score: null, paceStatus: null, paceHidden: true },
      { activityId: 'r2', score: 64, paceStatus: 'too_fast' },
    ]);
  });

  it('fails closed when the hidden-field read errors', async () => {
    respond = (op) => {
      if (op.table === 'athlete_activities') return { data: [run('r1', '2026-09-08T06:00:00')], error: null };
      if (op.table === 'feed_items') return { data: null, error: { message: 'boom' } };
      return { data: [], error: null };
    };
    cannedVerdicts = new Map([['r1', { activityId: 'r1', status: 'graded', score: 91, direction: 'on_target', workoutName: 'x' }]]);
    const body = await (await planScores(req())).json();
    expect(body.scores[0]).toMatchObject({ score: null, paceHidden: true });
  });

  it('a week with no plan returns the runs with no score (real loader)', async () => {
    respond = (op) => ({ data: op.table === 'athlete_activities' ? [run('r1', '2026-09-08T06:00:00')] : [], error: null });
    const res = await planScores(req());
    expect(res.status).toBe(200);
    expect((await res.json()).scores).toEqual([{ activityId: 'r1', score: null, paceStatus: null }]);
    expect(ops.some(o => o.table === 'weekly_plans')).toBe(true);
  });

  it('400s a malformed weekStart', async () => {
    expect((await planScores(req('?weekStart=sept'))).status).toBe(400);
  });
});

describe('GET /api/me/progress-summary', () => {
  const req = () => new Request('http://x/api/me/progress-summary', { headers: { authorization: 'Bearer t' } });

  it('401s an anonymous caller without touching the database', async () => {
    resolveVerifiedCaller.mockResolvedValue(anon());
    expect((await progress(req())).status).toBe(401);
    expect(ops).toHaveLength(0);
  });

  it('pages past 1000 rows, so an old record outside the newest thousand still counts', async () => {
    // 2,400 runs, the fastest 5K on the third page (row 2100).
    const all = Array.from({ length: 2400 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 86400_000).toISOString().slice(0, 10);
      return { id: `r${String(i).padStart(5, '0')}`, activity_name: null, activity_type: 'running', start_time: `${d}T07:00:00`, distance: 5000, duration: i === 2100 ? 1000 : 1500 };
    });
    respond = (op) => {
      if (op.table !== 'athlete_activities' || !selectOf(op).includes('activity_name')) return { data: [], error: null };
      const range = op.calls.find(c => c[0] === 'range')?.[1] as [number, number] | undefined;
      if (!range) return { data: all.slice(0, 1000), error: null }; // unpaged would be capped
      return { data: all.slice(range[0], range[1] + 1), error: null };
    };
    const res = await progress(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records['5k'].at(-1)).toMatchObject({ activityId: 'r02100', seconds: 1000 });
    const pages = ops.filter(o => o.table === 'athlete_activities' && selectOf(o).includes('activity_name'));
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it('counts the streak and its quality days, and masks nothing it was not given', async () => {
    const today = new Date();
    const iso = (back: number) => new Date(today.getTime() - back * 86400_000).toISOString().slice(0, 10);
    const intervalLaps = Array.from({ length: 8 }, (_, i) => i % 2
      ? { distance: 100, duration: 120 }   // walk recoveries
      : { distance: 1000, duration: 200, averageHR: 170 });
    const rows = [
      { id: 'a', start_time: `${iso(0)}T07:00:00`, activity_type: 'running', distance: 4400, duration: 1300, laps: intervalLaps },
      { id: 'b', start_time: `${iso(7)}T07:00:00`, activity_type: 'running', distance: 8000, duration: 2400, laps: null },
    ];
    respond = (op) => ({ data: op.table === 'athlete_activities' ? rows.map(r => ({ ...r, activity_name: null })) : [], error: null });
    const body = await (await progress(req())).json();
    expect(body.streak.weeks).toBeGreaterThanOrEqual(1);
    expect(body.streak.qualityDays).toBe(1);
  });
});
