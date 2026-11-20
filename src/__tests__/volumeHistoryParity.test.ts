// Before/after PAYLOAD parity for GET /api/athletes/volume-history.
// "before" = frozen copy of origin/main (fixtures/volumeHistoryRouteBaseline.ts);
// "after"  = the route as it stands on this branch.
// FIXTURE data only, fixed clock. Asserts identical status + JSON body and the
// same set of database queries (no extra query, none dropped).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextResponse } from 'next/server';
import { createMemoryDb } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-20T10:00:00+02:00')); // a Friday

const { client, tables, log } = createMemoryDb({
  schema: {
    athletes: ['id', 'week_start_day'],
    athlete_activities: ['id', 'athlete_id', 'start_time', 'distance', 'duration', 'activity_type'],
    weekly_plans: ['id', 'coach_id', 'week_start_date', 'parsed_workouts', 'status'],
  },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => client }));

type Who = () => { denied: Response | null; caller: any };
let caller: Who = () => ({ denied: null, caller: null });
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => caller(),
}));

const plan = (min: number, max: number) => ({
  group1: { workouts: [{ dayOfWeek: 0, name: 'א', distanceMinKm: min, distanceMaxKm: max, steps: [] }] },
  group2: { workouts: [] }, group3: { workouts: [] },
});

beforeAll(() => {
  tables.athletes.push({ id: 'mon', week_start_day: 1 }, { id: 'sun', week_start_day: 0 }, { id: 'empty', week_start_day: 1 });
  let n = 0;
  const day = (d: number) => new Date(Date.UTC(2026, 10, 20 - d, 6, 30)).toISOString().replace('.000Z', '+00:00');
  // 2300 rows for 'mon' over ~380 days (3 pages of 1000), with a 3-week gap.
  for (let i = 0; i < 2300; i++) {
    const d = Math.floor(i / 6);
    if (d >= 60 && d < 81) continue;
    tables.athlete_activities.push({ id: `r${String(n++).padStart(6, '0')}`, athlete_id: 'mon', start_time: day(d), distance: 5000 + (i % 7) * 1000, duration: 1500 + i % 300, activity_type: 'running' });
  }
  // rows the run filter must drop, and a Saturday-night run (week boundary)
  tables.athlete_activities.push(
    { id: 'x1', athlete_id: 'mon', start_time: day(3), distance: 30000, duration: 3600, activity_type: 'cycling' },
    { id: 'x2', athlete_id: 'mon', start_time: day(4), distance: 0, duration: 600, activity_type: 'running' },
    { id: 'x3', athlete_id: 'sun', start_time: '2026-11-14T21:30:00+00:00', distance: 12000, duration: 3600, activity_type: 'running' },
    { id: 'x4', athlete_id: 'sun', start_time: '2026-11-15T07:00:00+00:00', distance: 8000, duration: 2400, activity_type: null },
  );
  for (const [w, s, a, b] of [['2026-11-15', 'pushed', 90, 110], ['2026-11-08', 'draft', 50, 60], ['2026-11-08', 'pushed', 80, 95], ['2026-10-04', 'pushed', 70, 85]] as const) {
    tables.weekly_plans.push({ id: `p${w}${s}`, coach_id: COACH_ID, week_start_date: w, status: s, parsed_workouts: plan(a, b) });
  }
  tables.weekly_plans.push({ id: 'pnull', coach_id: COACH_ID, week_start_date: '2026-09-27', status: 'pushed', parsed_workouts: null });
  tables.weekly_plans.push({ id: 'pother', coach_id: 'someone-else', week_start_date: '2026-11-01', status: 'pushed', parsed_workouts: plan(10, 20) });
});

const self = (id: string): Who => () => ({ denied: null, caller: { athleteId: id, isStaff: false, isSuperUser: false, email: '', role: 'runner' } });
const staff: Who = () => ({ denied: null, caller: { athleteId: 'coach', isStaff: true, isSuperUser: false, email: '', role: 'coach' } });

async function run(mod: { GET: (r: Request) => Promise<Response> }, qs: string) {
  const start = log.length;
  const res = await mod.GET(new Request(`http://x/api/athletes/volume-history?${qs}`));
  const queries = log.slice(start).map((q) => `${q.table}|${q.op}|${q.columns}|${[...q.filters].sort().join('&')}`).sort();
  return { status: res.status, body: await res.json(), queries };
}

const CASES: Array<[string, string, Who]> = [
  ['week default (12), Monday athlete', 'athleteId=mon', self('mon')],
  ['week 52, Monday athlete, 3 pages', 'athleteId=mon&weeks=52', self('mon')],
  ['week 52, staff caller', 'athleteId=mon&weeks=52', staff],
  ['week 8, Sunday athlete (exact plan week)', 'athleteId=sun&weeks=8', self('sun')],
  ['week, athlete with no runs (dense zeros)', 'athleteId=empty&weeks=6', self('empty')],
  ['month 12', 'athleteId=mon&granularity=month', self('mon')],
  ['year 6', 'athleteId=mon&granularity=year', self('mon')],
  ['weeks clamp >52', 'athleteId=mon&weeks=400', self('mon')],
  ['missing athleteId -> 400', '', self('mon')],
  ['other athlete, non-staff -> 403', 'athleteId=sun', self('mon')],
  ['anonymous -> 401', 'athleteId=mon', () => ({ denied: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), caller: null })],
];

describe('volume-history before/after parity (fixture)', () => {
  for (const [name, qs, who] of CASES) {
    it(name, async () => {
      caller = who;
      const before = await run(await import('./fixtures/volumeHistoryRouteBaseline'), qs);
      const after = await run(await import('@/app/api/athletes/volume-history/route'), qs);
      expect(after.status).toBe(before.status);
      expect(after.body).toEqual(before.body);
      expect(after.queries).toEqual(before.queries);
      process.stdout.write(`PARITY ${name}: status=${after.status} queries=${after.queries.length} series=${after.body.series?.length ?? '-'} targets=${(after.body.series || []).filter((s: any) => s.target).length} km=${(after.body.series || []).reduce((a: number, s: any) => a + s.km, 0).toFixed(1)}\n`);
    });
  }
  it('fixture sanity: targets and km are actually present', async () => {
    caller = self('mon');
    const r = await run(await import('@/app/api/athletes/volume-history/route'), 'athleteId=mon&weeks=52');
    expect(r.body.series.filter((s: any) => s.target).length).toBeGreaterThanOrEqual(3);
    expect(r.body.series.some((s: any) => s.km === 0)).toBe(true);
    expect(r.queries.filter((q) => q.startsWith('athlete_activities')).length).toBe(3);
  });
});
