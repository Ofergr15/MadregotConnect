import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTrend, trendWeeks } from '@/lib/academy/trends';

// ── the hierarchy: admin → academy manager → academy coach → trainee ─────────

const db: Record<string, Record<string, unknown>[]> = {};
const updates: Array<{ table: string; row: Record<string, unknown>; id: unknown }> = [];

class Query {
  private rows: Record<string, unknown>[];
  private pending: Record<string, unknown> | null = null;
  constructor(private table: string) { this.rows = (db[table] || []).map((r) => ({ ...r })); }
  select() { return this; }
  update(row: Record<string, unknown>) { this.pending = row; return this; }
  eq(col: string, v: unknown) {
    if (this.pending) { updates.push({ table: this.table, row: this.pending, id: v }); return Promise.resolve({ error: null }); }
    this.rows = this.rows.filter((r) => col === 'coach_id' || r[col] === v); return this;
  }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }); }
  then(res: (v: unknown) => unknown) { return Promise.resolve({ data: this.rows, error: null }).then(res); }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async () => {}) }));

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: caller() }),
}));

const { isAcademyManager, canAdmitToAcademy } = await import('@/lib/academy/pairing-server');
const coaches = await import('@/app/api/academy/coaches/route');

const admin = { athleteId: 'boss', role: 'admin', roles: ['admin'], isStaff: true, isSuperUser: false, email: 'b' };
const manager = { athleteId: 'mgr', role: 'runner', roles: ['runner', 'academy_manager'], isStaff: true, isSuperUser: false, email: 'm' };
const coach = { athleteId: 'dana', role: 'academy_coach', roles: ['academy_coach'], isStaff: true, isSuperUser: false, email: 'd' };
const put = (body: unknown) => coaches.PUT(new Request('http://x/api/academy/coaches', { method: 'PUT', body: JSON.stringify(body) }));

beforeEach(() => {
  db.athletes = [
    { id: 'dana', name: 'Dana', role: 'academy_coach', extra_roles: [], approved: true, status: 'active', is_academy: false, academy_coach_id: null },
    { id: 'avi', name: 'Avi', role: 'runner', extra_roles: ['academy_coach'], approved: true, status: 'active', is_academy: false, academy_coach_id: null },
    { id: 'boss', name: 'Boss', role: 'admin', extra_roles: [], approved: true, status: 'active', is_academy: false, academy_coach_id: null },
    { id: 'sh', name: 'Shalev', role: 'runner', extra_roles: null, approved: true, status: 'active', is_academy: false, academy_coach_id: null },
    { id: 't1', name: 'Yoav', role: 'runner', extra_roles: null, approved: true, status: 'active', is_academy: true, academy_coach_id: 'dana' },
  ];
  updates.length = 0;
});

describe('who runs the academy', () => {
  it('admins and academy managers manage; a coach does not, and only a manager admits', () => {
    expect(isAcademyManager(admin)).toBe(true);
    expect(isAcademyManager(manager)).toBe(true);
    expect(isAcademyManager(coach)).toBe(false);
    expect(canAdmitToAcademy(manager)).toBe(true);
    expect(canAdmitToAcademy(coach)).toBe(false);
  });
});

describe('the manager names coaches', () => {
  it('refuses a coach', async () => {
    caller.mockReturnValue(coach);
    expect((await put({ athleteId: 'sh', coach: true })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('adds the academy_coach role and nothing else', async () => {
    caller.mockReturnValue(manager);
    expect((await put({ athleteId: 'sh', coach: true })).status).toBe(200);
    expect(updates[0]).toMatchObject({ id: 'sh', row: { role: 'academy_coach', extra_roles: [] } });
  });

  it('keeps an admin an admin when making them a coach too', async () => {
    caller.mockReturnValue(manager);
    await put({ athleteId: 'boss', coach: true });
    expect(updates[0].row).toEqual({ role: 'admin', extra_roles: ['academy_coach'] });
  });

  it('will not remove a coach who still holds trainees', async () => {
    caller.mockReturnValue(manager);
    const res = await put({ athleteId: 'dana', coach: false });
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('removes a coach with nobody', async () => {
    caller.mockReturnValue(manager);
    expect((await put({ athleteId: 'avi', coach: false })).status).toBe(200);
    expect(updates[0].row).toEqual({ role: 'runner', extra_roles: [] });
  });

  it('lists coaches with their caseload and who could be added', async () => {
    caller.mockReturnValue(manager);
    const body = await (await coaches.GET(new Request('http://x/api/academy/coaches'))).json();
    expect(body.coaches.map((c: { id: string; trainees: number }) => [c.id, c.trainees])).toEqual([['dana', 1], ['avi', 0]]);
    expect(body.candidates.map((c: { id: string }) => c.id)).toEqual(['boss', 'sh', 't1']);
  });
});

describe('the weekly trend', () => {
  it('counts trainees by join date, joiners, km and completion per plan week', () => {
    const weeks = trendWeeks('2026-10-04', 3);
    expect(weeks).toEqual(['2026-09-20', '2026-09-27', '2026-10-04']);
    const t = buildTrend({
      weeks,
      members: [{ joinedOn: null }, { joinedOn: '2026-09-22' }, { joinedOn: '2026-10-05' }],
      runs: [{ weekStart: '2026-10-04', meters: 10_400 }, { weekStart: '2026-10-04', meters: 5_200 }, { weekStart: '2026-09-27', meters: 8_000 }],
      adherence: new Map([['2026-10-04', { planned: 4, completed: 3 }], ['2026-09-27', { planned: 0, completed: 0 }]]),
    });
    expect(t.map((w) => w.trainees)).toEqual([2, 2, 3]);
    expect(t.map((w) => w.joined)).toEqual([1, 0, 1]);
    expect(t.map((w) => w.km)).toEqual([0, 8, 16]);
    expect(t.map((w) => w.runs)).toEqual([0, 1, 2]);
    expect(t.map((w) => w.completionRate)).toEqual([null, null, 0.75]);
  });
});
