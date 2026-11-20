import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native Today screen (plan H1): GET /api/dashboard/weekly. The real route
 * handler (and the real week math in lib/plans) runs against a fake Supabase client; only
 * auth and the DB are faked. If one of these breaks, the native decoder breaks with it —
 * change the app's models in the same change.
 */

type Op = [string, ...unknown[]];
type Q = { table: string; ops: Op[] };
const log: Q[] = [];
let answer: (q: Q) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function builder(table: string) {
  const q: Q = { table, ops: [] };
  log.push(q);
  const b: any = new Proxy({}, {
    get(_t, m: string) {
      if (m === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer(q)).then(res, rej);
      if (m === 'maybeSingle' || m === 'single') return async () => answer(q);
      return (...args: unknown[]) => { q.ops.push([m, ...args]); return b; };
    },
  });
  return b;
}
const db = { from: (t: string) => builder(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

let caller: { athleteId: string | null; isStaff: boolean; isSuperUser: boolean } | null = null;
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => (caller
    ? { denied: null, caller }
    : { denied: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }), caller: null }),
}));

const weekly = await import('@/app/api/dashboard/weekly/route');

const ME = '11111111-1111-4111-8111-111111111111';
const req = () => new Request('http://x/api/dashboard/weekly', { headers: { authorization: 'Bearer t' } });
const run = (dayOfWeek: number, m: number, name = 'ריצה') => ({
  dayOfWeek, name, type: 'easy', steps: [{ type: 'run', durationType: 'distance', durationValue: m }],
});
const plan = (week: string, workouts: unknown[], extra: Record<string, unknown> = {}) => ({
  id: `p-${week}`, week_start_date: week, parsed_workouts: { workouts }, status: 'pushed',
  created_at: `${week}T06:00:00Z`, athlete_id: null, ...extra,
});
let plans: unknown[] = [];
const dbFor = (q: Q) => {
  // The route asks newest-first (and reverses); answer the way Postgres would.
  if (q.table === 'weekly_plans') return { data: [...plans].sort((a: any, b: any) => b.week_start_date.localeCompare(a.week_start_date)), error: null };
  if (q.table === 'athletes') return { data: { is_academy: false, group_id: 'g1' }, error: null };
  if (q.table === 'day_sessions') return { data: [], error: null };
  return { data: null, error: null };
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  log.length = 0; caller = { athleteId: ME, isStaff: false, isSuperUser: false }; plans = []; answer = dbFor;
});
afterEach(() => { vi.useRealTimers(); });

describe('GET /api/dashboard/weekly — auth', () => {
  it('no session → 401 (Bearer required)', async () => {
    caller = null;
    expect((await weekly.GET(req())).status).toBe(401);
  });
  it('reads the club plan plus ONLY the caller\'s own personal rows', async () => {
    at('2026-11-20T09:00:00Z');
    await weekly.GET(req());
    const q = log.find((x) => x.table === 'weekly_plans')!;
    expect(q.ops).toContainEqual(['or', `athlete_id.is.null,athlete_id.eq.${ME}`]);
    expect(q.ops).toContainEqual(['limit', 20]);
  });
});

describe('GET /api/dashboard/weekly — shape', () => {
  it('→ the full Today payload for a week with a plan (Sunday-anchored)', async () => {
    at('2026-11-18T09:00:00Z'); // Wednesday 11:00 Israel → plan week starts Sunday 2026-11-15
    plans = [plan('2026-11-08', [run(2, 10000)]), plan('2026-11-15', [run(0, 12000, 'ארוכה'), run(2, 8000)])];
    const res = await weekly.GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      'currentWeekStart', 'dailyDistances', 'hasClubPlan', 'hasPlan', 'longRunProgression', 'prevWeekTotal',
      'publishedAt', 'sessions', 'trainingDays', 'typeDistribution', 'weekDelta', 'weekTotalMax', 'weekTotalMin', 'weeklyVolumes',
    ]);
    expect(body).toMatchObject({
      currentWeekStart: '2026-11-15', hasPlan: true, hasClubPlan: true, publishedAt: '2026-11-15T06:00:00Z',
      weekTotalMin: 20, weekTotalMax: 20, prevWeekTotal: 10, weekDelta: 100, trainingDays: 2,
      weeklyVolumes: [{ week: '2026-11-08', volume: 10, weekNum: 1 }, { week: '2026-11-15', volume: 20, weekNum: 2 }],
      longRunProgression: [{ week: '2026-11-08', distance: 10 }, { week: '2026-11-15', distance: 12 }],
    });
    // Always 7 entries, Sunday (0) first; a day carries only dayOfWeek — combine with currentWeekStart.
    expect(body.dailyDistances.map((d: any) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Object.keys(body.dailyDistances[0]).sort()).toEqual(['day', 'dayOfWeek', 'max', 'min', 'requiredMax', 'requiredMin', 'sessions', 'type']);
    expect(body.dailyDistances[0]).toMatchObject({ min: 12, max: 12 });
    expect(body.dailyDistances[1]).toMatchObject({ min: 0, max: 0, sessions: [] });
    expect(body.sessions.map((s: any) => [s.dayOfWeek, s.name, s.kmMin])).toEqual([[0, 'ארוכה', 12], [2, 'ריצה', 8]]);
    for (const k of ['key', 'dayOfWeek', 'name', 'type', 'kind', 'partIndex', 'partCount', 'optional', 'kmMin', 'kmMax', 'kmFrom', 'durationSec', 'steps']) {
      expect(body.sessions[0]).toHaveProperty(k);
    }
  });

  it('a week with no plan → hasPlan:false, everything zeroed — NEVER another week\'s plan', async () => {
    at('2026-11-18T09:00:00Z');
    plans = [plan('2026-11-01', [run(2, 10000)])]; // newest plan is two weeks back
    const body = await (await weekly.GET(req())).json();
    expect(body).toMatchObject({
      currentWeekStart: '2026-11-15', hasPlan: false, hasClubPlan: false, publishedAt: null,
      weekTotalMin: 0, weekTotalMax: 0, weekDelta: 0, prevWeekTotal: 0, trainingDays: 0, sessions: [],
    });
    expect(body.dailyDistances).toHaveLength(7);
    expect(body.dailyDistances.every((d: any) => d.min === 0 && d.max === 0)).toBe(true);
    // History still lists the older week.
    expect(body.weeklyVolumes).toEqual([{ week: '2026-11-01', volume: 10, weekNum: 1 }]);
  });

  it('no plan this week but one LAST week → weekDelta -100 (not 0): gate the delta pill on hasPlan', async () => {
    at('2026-11-18T09:00:00Z');
    plans = [plan('2026-11-08', [run(2, 10000)])];
    expect(await (await weekly.GET(req())).json()).toMatchObject({ hasPlan: false, prevWeekTotal: 10, weekDelta: -100 });
  });

  it('a draft plan counts for hasPlan but publishedAt stays null (only "pushed" sets it)', async () => {
    at('2026-11-18T09:00:00Z');
    plans = [plan('2026-11-15', [run(1, 5000)], { status: 'draft' })];
    expect(await (await weekly.GET(req())).json()).toMatchObject({ hasPlan: true, publishedAt: null });
  });

  it('DB/handler failure → 500 { error: "Failed to fetch weekly data" }', async () => {
    at('2026-11-18T09:00:00Z');
    answer = () => { throw new Error('boom'); };
    const res = await weekly.GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch weekly data' });
  });
});

describe('GET /api/dashboard/weekly — plan week anchor and Saturday 20:00 Israel rollover', () => {
  const weekAt = async (iso: string) => { at(iso); return (await (await weekly.GET(req())).json()).currentWeekStart; };

  it('the plan week starts on SUNDAY (not the Monday activity week)', async () => {
    expect(await weekAt('2026-11-15T10:00:00Z')).toBe('2026-11-15'); // Sunday
    expect(await weekAt('2026-11-16T10:00:00Z')).toBe('2026-11-15'); // Monday
    expect(await weekAt('2026-11-20T10:00:00Z')).toBe('2026-11-15'); // Friday
  });
  it('Saturday before 20:00 Israel → still this week', async () => {
    expect(await weekAt('2026-11-21T17:59:00Z')).toBe('2026-11-15'); // 19:59 Israel (UTC+2)
  });
  it('Saturday from 20:00 Israel → NEXT week (preview), so dayOfWeek 0 is tomorrow, not "today"', async () => {
    expect(await weekAt('2026-11-21T18:00:00Z')).toBe('2026-11-22'); // 20:00 Israel
    expect(await weekAt('2026-11-21T21:59:00Z')).toBe('2026-11-22'); // 23:59 Israel, still Saturday
  });
  it('the cutoff is Israel wall-clock, so it moves with DST (UTC+3 in summer)', async () => {
    expect(await weekAt('2026-06-13T16:59:00Z')).toBe('2026-06-07'); // Sat 19:59 IDT
    expect(await weekAt('2026-06-13T17:00:00Z')).toBe('2026-06-14'); // Sat 20:00 IDT
  });
  it('Saturday evening UTC that is already Sunday in Israel → the new week', async () => {
    expect(await weekAt('2026-11-21T22:30:00Z')).toBe('2026-11-22'); // Sun 00:30 Israel
  });
  it('after the rollover, weekDelta/prevWeekTotal compare against the week BEFORE the displayed one', async () => {
    plans = [plan('2026-11-15', [run(2, 10000)]), plan('2026-11-22', [run(0, 15000)])];
    at('2026-11-21T19:00:00Z');
    const body = await (await weekly.GET(req())).json();
    expect(body).toMatchObject({ currentWeekStart: '2026-11-22', hasPlan: true, prevWeekTotal: 10, weekDelta: 50 });
  });
});
