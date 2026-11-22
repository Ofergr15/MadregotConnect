import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native client's weekly plan (plan H3, docs/contracts/weekly-plan.md):
 * the member-facing reads of `weekly_plans` — GET /api/plans/week, GET /api/plans/weeks,
 * and the plan part of GET /api/dashboard/weekly. (GET /api/plans is staff-only and is
 * pinned here only as that.)
 *
 * REAL route handlers + the REAL scope rules (lib/plans/scope*.ts) against an in-memory
 * fake Supabase client. Only auth, the DB, the trainee-pairing check and the pace-lane
 * lookup (groupNumberForAthlete, its own pack-history tables) are faked.
 *
 * "a draft is never shown to a runner" is enforced since 2026-11-20 (scope.ts withoutDraftsFor);
 * /api/plans/weeks still lists draft weeks (dates only) — the one remaining KNOWN GAP.
 */

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};

function match(row: Row, ops: unknown[][]): boolean {
  for (const [m, col, v, w] of ops as [string, string, any, any][]) {
    if (m === 'eq' && row[col] !== v) return false;
    if (m === 'is' && v === null && row[col] != null) return false;
    if (m === 'not' && v === 'is' && w === null && row[col] == null) return false;
    if (m === 'in' && !(v as unknown[]).includes(row[col])) return false;
    if (m === 'gte' && !(row[col] >= v)) return false;
    if (m === 'lte' && !(row[col] <= v)) return false;
    if (m === 'or') {
      const alts = String(col).split(',').map((s) => s.split('.'));
      if (!alts.some(([c, op, ...rest]) => (op === 'is' ? row[c] == null : row[c] === rest.join('.')))) return false;
    }
  }
  return true;
}
function builder(table: string) {
  const ops: unknown[][] = [];
  const run = () => {
    let hit = (tables[table] || []).filter((r) => match(r, ops));
    const order = ops.find(([m]) => m === 'order') as [string, string, { ascending?: boolean }] | undefined;
    if (order) hit = [...hit].sort((a, b) => (a[order[1]] < b[order[1]] ? -1 : 1) * (order[2]?.ascending === false ? -1 : 1));
    const limit = ops.find(([m]) => m === 'limit') as [string, number] | undefined;
    if (limit) hit = hit.slice(0, limit[1]);
    return { data: hit, error: null };
  };
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'not', 'or', 'gte', 'lte', 'order', 'limit']) {
    b[m] = (...args: unknown[]) => { ops.push([m, ...args]); return b; };
  }
  b.maybeSingle = async () => ({ data: run().data[0] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
  return b;
}
const db = { from: (t: string) => builder(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

let caller: { athleteId: string | null; isStaff: boolean; isSuperUser: boolean } | null = null;
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => (caller
    ? { denied: null, caller }
    : { denied: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }), caller: null }),
  requireMember: async () => (caller ? null : new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })),
}));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => (caller ? { ok: true, user: { ...caller, email: 'x' } } : { ok: false, status: 401, error: 'Authentication required' }),
}));
vi.mock('@/lib/academy/pairing-server', () => ({ requireTraineeAccess: async () => ({ denied: new Response('{}', { status: 403 }) }), academyTraineesNotYours: async () => [] }));
vi.mock('@/lib/plans/match-athlete-activities', () => ({ groupNumberForAthlete: async () => 2 }));

const week = await import('@/app/api/plans/week/route');
const weeks = await import('@/app/api/plans/weeks/route');
const weekly = await import('@/app/api/dashboard/weekly/route');
const plans = await import('@/app/api/plans/route');
const { COACH_ID } = await import('@/lib/constants');
const { NextRequest } = await import('next/server');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WEEK = '2026-11-15'; // a Sunday — plan weeks start Sunday
const NOW = new Date('2026-11-19T08:00:00Z'); // Thursday of WEEK

const workout = (dayOfWeek: number, km: number, name = 'ריצה') => ({ dayOfWeek, name, steps: [], distanceMinKm: km, distanceMaxKm: km });
let seq = 0;
const plan = (o: Row & { km?: number }): Row => {
  const { km = 10, ...rest } = o;
  return { id: `p${++seq}`, coach_id: COACH_ID, week_start_date: WEEK, athlete_id: null, status: 'pushed', created_at: `2026-11-1${seq % 5}T10:00:00Z`, parsed_workouts: { workouts: [workout(2, km)] }, ...rest };
};

const getWeek = (q = `weekStart=${WEEK}`) => week.GET(new NextRequest(`http://x/api/plans/week?${q}`));
const km = (body: Row) => body.weekTotalMax;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  seq = 0;
  caller = { athleteId: ME, isStaff: false, isSuperUser: false };
  tables = {
    weekly_plans: [],
    athletes: [{ id: ME, is_academy: false, group_id: 'g1' }, { id: OTHER, is_academy: true, group_id: 'g1' }],
    day_sessions: [],
  };
});
afterEach(() => vi.useRealTimers());

describe('GET /api/plans/week?weekStart=YYYY-MM-DD', () => {
  it('no session → 401; bad weekStart → 400 { error } (auth first)', async () => {
    caller = null;
    expect((await getWeek('weekStart=nope')).status).toBe(401);
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    const res = await getWeek('weekStart=2026-11-1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'weekStart (YYYY-MM-DD) is required' });
  });
  it('no plan → exact empty shape with hasPlan:false (never another week\'s plan)', async () => {
    tables.weekly_plans = [plan({ week_start_date: '2026-11-08' })];
    expect(await (await getWeek()).json()).toEqual({
      hasPlan: false, hasClubPlan: false, weekStart: WEEK, dailyDistances: [], sessions: [], typeDistribution: {}, weekTotalMin: 0, weekTotalMax: 0, trainingDays: 0,
    });
  });
  it('club plan (athlete_id NULL), pushed → hasPlan, ownPlan:false, publishedAt = created_at, 7 Sunday-first days', async () => {
    const p = plan({ km: 12 });
    tables.weekly_plans = [p];
    const body = await (await getWeek()).json();
    expect(body).toMatchObject({ hasPlan: true, hasClubPlan: true, weekStart: WEEK, publishedAt: p.created_at, lane: null, ownPlan: false, weekTotalMax: 12, trainingDays: 1 });
    expect(body.dailyDistances.map((d: Row) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(body.dailyDistances[2]).toMatchObject({ dayOfWeek: 2, max: 12 });
    expect(Object.keys(body).sort()).toEqual(['dailyDistances', 'hasClubPlan', 'hasPlan', 'lane', 'ownPlan', 'publishedAt', 'sessions', 'trainingDays', 'typeDistribution', 'weekRequiredMax', 'weekRequiredMin', 'weekStart', 'weekTotalMax', 'weekTotalMin']);
  });
  it('pushed beats draft for the same week, whichever order the rows come back in', async () => {
    tables.weekly_plans = [plan({ status: 'draft', km: 99 }), plan({ km: 10 })];
    expect(km(await (await getWeek()).json())).toBe(10);
    tables.weekly_plans.reverse();
    expect(km(await (await getWeek()).json())).toBe(10);
  });
  it('partial is published too, but publishedAt is only set for "pushed"', async () => {
    tables.weekly_plans = [plan({ status: 'partial', km: 11 })];
    expect(await (await getWeek()).json()).toMatchObject({ hasPlan: true, weekTotalMax: 11, publishedAt: null });
  });
  it('a week whose ONLY row is a draft is no plan for a runner', async () => {
    tables.weekly_plans = [plan({ status: 'draft', km: 33 })];
    expect((await (await getWeek()).json()).hasPlan).toBe(false);
  });
  it('a draft never beats a sent partial week', async () => {
    tables.weekly_plans = [plan({ status: 'partial', km: 11 }), plan({ status: 'draft', km: 44 })];
    expect(km(await (await getWeek()).json())).toBe(11);
  });
  it('my own academy row beats the club plan — but my DRAFT does not: the club\'s pushed week shows', async () => {
    tables.athletes[0].is_academy = true;
    tables.weekly_plans = [plan({ km: 10 }), plan({ athlete_id: ME, km: 20 })];
    expect(await (await getWeek()).json()).toMatchObject({ ownPlan: true, weekTotalMax: 20 });
    tables.weekly_plans = [plan({ km: 10 }), plan({ athlete_id: ME, status: 'draft', km: 20 })];
    expect(await (await getWeek()).json()).toMatchObject({ ownPlan: false, weekTotalMax: 10 });
  });
  it('another trainee\'s personal row is never served, whatever its status', async () => {
    tables.weekly_plans = [plan({ km: 10 }), plan({ athlete_id: OTHER, km: 77 })];
    expect(await (await getWeek()).json()).toMatchObject({ ownPlan: false, weekTotalMax: 10 });
    tables.weekly_plans = [plan({ athlete_id: OTHER, km: 77 })];
    expect((await (await getWeek()).json()).hasPlan).toBe(false);
  });
  it('left the academy (is_academy:false) → my old personal row no longer counts; the club week is back', async () => {
    tables.weekly_plans = [plan({ km: 10 }), plan({ athlete_id: ME, km: 20 })];
    expect(await (await getWeek()).json()).toMatchObject({ ownPlan: false, weekTotalMax: 10 });
  });
  it('weekStart is taken literally — a Monday key finds nothing (the client must send the Sunday)', async () => {
    tables.weekly_plans = [plan({})];
    expect((await (await getWeek('weekStart=2026-11-16')).json()).hasPlan).toBe(false);
  });
});

describe('GET /api/dashboard/weekly (plan part)', () => {
  const getWeekly = () => weekly.GET(new Request('http://x/api/dashboard/weekly'));
  it('no session → 401', async () => {
    caller = null;
    expect((await getWeekly()).status).toBe(401);
  });
  it('currentWeekStart is the Sunday of the displayed week; no plan → hasPlan:false, zeros', async () => {
    const body = await (await getWeekly()).json();
    expect(body).toMatchObject({ currentWeekStart: WEEK, hasPlan: false, hasClubPlan: false, weekTotalMin: 0, weekTotalMax: 0, publishedAt: null });
  });
  it('Saturday 20:00 Israel rolls the displayed week forward to the next Sunday', async () => {
    vi.setSystemTime(new Date('2026-11-21T18:30:00Z')); // Sat 20:30 Israel
    expect((await (await getWeekly()).json()).currentWeekStart).toBe('2026-11-22');
  });
  it('same precedence as /api/plans/week: pushed over draft, own row over club, publishedAt only for pushed', async () => {
    const p = plan({ km: 10 });
    tables.weekly_plans = [plan({ status: 'draft', km: 99 }), p];
    expect(await (await getWeekly()).json()).toMatchObject({ hasPlan: true, weekTotalMax: 10, publishedAt: p.created_at });
    tables.athletes[0].is_academy = true;
    tables.weekly_plans.push(plan({ athlete_id: ME, km: 20 }));
    expect((await (await getWeekly()).json()).weekTotalMax).toBe(20);
  });
  it('a draft-only week is no plan for a runner (hasPlan:false)', async () => {
    tables.weekly_plans = [plan({ status: 'draft', km: 33 })];
    expect((await (await getWeekly()).json()).hasPlan).toBe(false);
  });
});

describe('GET /api/plans/weeks', () => {
  it('→ { weekStarts: string[] } distinct, newest first', async () => {
    tables.weekly_plans = [plan({}), plan({ week_start_date: '2026-11-08' }), plan({ status: 'draft' })];
    expect(await (await weeks.GET(new Request('http://x'))).json()).toEqual({ weekStarts: [WEEK, '2026-11-08'] });
  });
  it('KNOWN GAP: lists weeks that have only a draft, or only ANOTHER athlete\'s personal row', async () => {
    tables.weekly_plans = [plan({ week_start_date: '2026-11-22', status: 'draft' }), plan({ week_start_date: '2026-11-29', athlete_id: OTHER })];
    expect((await (await weeks.GET(new Request('http://x'))).json()).weekStarts).toEqual(['2026-11-29', '2026-11-22']);
  });
});

describe('GET /api/plans (raw rows) is staff-only', () => {
  it('a runner → 403', async () => {
    const res = await plans.GET(new NextRequest(`http://x/api/plans?coach_id=${COACH_ID}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Staff access required' });
  });
});
