import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/academy/dispatch now carries `roster` beside the verdicts: per trainee in
 * scope, whether Garmin is linked and how many workouts their OWN plan for the week
 * holds — the input the plans screen needs for "no plan yet" and "never sent".
 * Pinned here: the scope (a coach sees only their own), the individual-plan-only
 * count, and that the credential itself never leaves.
 */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { athletes: [], workout_deliveries: [], athlete_activities: [], weekly_plans: [] };

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private desc: string | null = null;
  constructor(private table: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  in(c: string, v: unknown[]) { this.filters.push(r => v.includes(r[c])); return this; }
  gte(c: string, v: string) { this.filters.push(r => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.filters.push(r => String(r[c]) <= v); return this; }
  lt(c: string, v: string) { this.filters.push(r => String(r[c]) < v); return this; }
  order(c: string, o?: { ascending?: boolean }) { if (o?.ascending === false) this.desc = c; return this; }
  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    ok?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    let rows = (db[this.table] || []).filter(r => this.filters.every(f => f(r)));
    if (this.desc) rows = [...rows].sort((a, b) => String(b[this.desc!]).localeCompare(String(a[this.desc!])));
    return Promise.resolve({ data: rows, error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));
vi.mock('@/lib/constants', () => ({ COACH_ID: 'club' }));

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/academy/pairing-server', () => ({ isAcademyManager: (c: { manager?: boolean }) => !!c.manager }));

const { GET } = await import('@/app/api/academy/dispatch/route');
const WEEK = '2026-10-04';
const get = () => GET(new Request(`http://x/api/academy/dispatch?weekStart=${WEEK}`));
const as = (caller: Row) => resolveVerifiedCaller.mockResolvedValue({
  denied: null, caller: { isSuperUser: false, isStaff: true, athleteId: 'coach-1', ...caller },
});

beforeEach(() => {
  db.athletes = [
    { id: 't1', name: 'Tom', coach_id: 'club', is_academy: true, academy_coach_id: 'coach-1', garmin_auth: 'SECRET' },
    { id: 't2', name: 'Lia', coach_id: 'club', is_academy: true, academy_coach_id: 'coach-1', garmin_auth: null },
    { id: 't3', name: 'Raz', coach_id: 'club', is_academy: true, academy_coach_id: 'coach-2', garmin_auth: 'SECRET' },
    { id: 'r1', name: 'Runner', coach_id: 'club', is_academy: false, academy_coach_id: null, garmin_auth: 'SECRET' },
  ];
  db.workout_deliveries = [{ athlete_id: 't1', workout_date: '2026-10-05', status: 'success', created_at: '2026-10-04T08:00:00Z' }];
  db.athlete_activities = [];
  db.weekly_plans = [
    { athlete_id: 't1', week_start_date: WEEK, created_at: '2026-10-02', parsed_workouts: { workouts: [{}, {}, {}] } },
    { athlete_id: 't1', week_start_date: WEEK, created_at: '2026-10-01', parsed_workouts: { workouts: [{}] } },
    { athlete_id: 't3', week_start_date: WEEK, created_at: '2026-10-02', parsed_workouts: { workouts: [{}, {}] } },
    // The club's shared plan is not a plan anybody built for a trainee.
    { athlete_id: null, week_start_date: WEEK, created_at: '2026-10-02', parsed_workouts: { workouts: [{}, {}, {}, {}] } },
  ];
});

describe('dispatch roster', () => {
  it('a coach gets only their own trainees, with their own newest plan counted', async () => {
    as({});
    const body = await (await get()).json();
    expect(body.roster.map((r: Row) => r.athleteId)).toEqual(['t1', 't2']);
    const t1 = body.roster.find((r: Row) => r.athleteId === 't1');
    const t2 = body.roster.find((r: Row) => r.athleteId === 't2');
    expect(t1).toMatchObject({ hasGarmin: true, planWorkouts: 3 });
    expect(t2).toMatchObject({ hasGarmin: false, planWorkouts: 0 });
  });

  it('the manager gets every trainee, and never the credential', async () => {
    as({ manager: true });
    const res = await get();
    const text = await res.text();
    expect(text).not.toContain('SECRET');
    const body = JSON.parse(text);
    expect(body.roster.map((r: Row) => r.athleteId)).toEqual(['t1', 't2', 't3']);
  });

  it('is still staff-only', async () => {
    as({ isStaff: false });
    expect((await get()).status).toBe(403);
  });
});
