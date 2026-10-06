import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';

/**
 * `GET /api/academy/home` — the home's growth chart, month moves, today's tests,
 * approvals and (manager only) funnel. The scoping is the part that matters: a
 * coach must see only their own trainees and leavers, and never the funnel.
 */

const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireStaffCaller: (req: Request) => requireStaffCaller(req),
}));
vi.mock('@/lib/academy/settings-server', () => ({
  loadAcademySettings: () => Promise.resolve({ coachCapacity: 6 }),
}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const reads: string[] = [];

class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: string) { reads.push(table); }
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((r) => r[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((r) => values.includes(r[column])); return this; }
  private settle() {
    const rows = db[this.table];
    if (!rows) return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
    return { data: rows.filter((r) => this.filters.every((f) => f(r))), error: null };
  }
  then<R1 = { data: Row[] | null; error: unknown }, R2 = never>(
    ok?: ((v: { data: Row[] | null; error: unknown }) => R1 | PromiseLike<R1>) | null,
    bad?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.settle()).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (t: string) => new Query(t) }),
}));

const { GET } = await import('@/app/api/academy/home/route');

const today = israelToday();
const daysAgo = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
};
const athlete = (id: string, o: Row = {}): Row => ({
  id, name: id, coach_id: COACH_ID, is_academy: true, approved: true, status: 'active', academy_joined_on: daysAgo(60), academy_coach_id: 'dana', ...o,
});

function asManager() {
  requireStaffCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'boss', role: 'admin', isStaff: true, isSuperUser: true } });
}
function asCoach(id = 'dana') {
  requireStaffCaller.mockResolvedValue({ denied: null, caller: { athleteId: id, role: 'academy_coach', isStaff: true, isSuperUser: false } });
}
const get = (q = '') => GET(new Request(`http://x/api/academy/home${q}`));

beforeEach(() => {
  reads.length = 0;
  for (const k of Object.keys(db)) delete db[k];
  db.athletes = [
    athlete('dana', { is_academy: false, academy_joined_on: null, academy_coach_id: null }),
    athlete('a1'),
    athlete('a2', { academy_coach_id: 'guy', academy_joined_on: daysAgo(3) }),
    athlete('new1', { academy_coach_id: null, academy_joined_on: daysAgo(1) }),
    athlete('gone', { is_academy: false, academy_joined_on: daysAgo(90) }),
    athlete('applicant', { approved: false }),
  ];
  db.academy_coach_history = [
    { athlete_id: 'gone', coach_id: 'dana', started_on: daysAgo(90), ended_on: daysAgo(2) },
  ];
  db.academy_test_invitations = [
    { athlete_id: 'a1', status: 'confirmed', confirmed_slot: new Date().toISOString() },
    { athlete_id: 'a2', status: 'confirmed', confirmed_slot: new Date().toISOString() },
  ];
  db.academy_tests = [
    { athlete_id: 'a2', status: 'pending', submitted_at: '2026-10-01T10:00:00Z' },
    { athlete_id: 'a1', status: 'approved', submitted_at: '2026-09-01T10:00:00Z' },
  ];
  db.academy_candidates = [
    { id: 'c1', name: 'Lior Katz', athlete_id: null, archived_at: null, accepted_at: null, created_at: new Date(Date.now() - 86_400_000).toISOString() },
    { id: 'c2', name: 'Was Accepted', athlete_id: null, archived_at: null, accepted_at: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' },
  ];
  db.academy_candidate_events = [
    { candidate_id: 'c1', stage: 'form', occurred_at: new Date(Date.now() - 86_400_000).toISOString() },
  ];
});

describe('GET /api/academy/home', () => {
  it('refuses a non-staff caller', async () => {
    requireStaffCaller.mockResolvedValue({ denied: new Response('no', { status: 403 }), caller: {} });
    expect((await get()).status).toBe(403);
  });

  it('gives the manager the whole academy, leavers included, and the funnel', async () => {
    asManager();
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe('academy');
    expect(body.weeks).toHaveLength(12);
    // Eleven weeks back only `gone` (joined 90 days ago) was in; today a1, a2 and new1 are,
    // and `gone` left two days ago — one red dot, in one of the last two weeks.
    expect(body.weeks[0].trainees).toBe(1);
    expect(body.weeks[11].trainees).toBe(3);
    expect(body.weeks.reduce((n: number, w: { left: number }) => n + w.left, 0)).toBe(1);
    expect(body.today.count).toBe(2);
    expect(body.approvals).toEqual([{ athleteId: 'a2', name: 'a2', submittedAt: '2026-10-01T10:00:00Z' }]);
    expect(body.funnel.live).toBe(1);
    expect(body.funnel.forms.map((f: { id: string }) => f.id)).toEqual(['c1']);
    expect(body.coachCapacity).toBe(6);
  });

  it('scopes a coach to their own trainees and leavers, with no funnel', async () => {
    asCoach('dana');
    const body = await (await get()).json();
    expect(body.scope).toBe('coach');
    expect(body.funnel).toBeNull();
    expect(reads).not.toContain('academy_candidates');
    // Only a1 is Dana's today; `gone` was hers.
    expect(body.today.count).toBe(1);
    expect(body.approvals).toEqual([]);
    expect(body.weeks[11].trainees).toBe(1);
    expect(body.weeks.reduce((n: number, w: { left: number }) => n + w.left, 0)).toBe(1);
  });

  it('narrows a manager in their coach view', async () => {
    asManager();
    const body = await (await get('?scope=coach')).json();
    expect(body.scope).toBe('coach');
    expect(body.funnel).toBeNull();
  });

  it('survives the optional tables being absent', async () => {
    asManager();
    delete db.academy_test_invitations;
    delete db.academy_tests;
    delete db.academy_coach_history;
    delete db.academy_candidates;
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toEqual({ count: 0, firstAt: null });
    expect(body.approvals).toEqual([]);
    expect(body.funnel).toBeNull();
  });

  it('reads everything in one parallel round', async () => {
    asManager();
    const t0 = performance.now();
    await get();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
