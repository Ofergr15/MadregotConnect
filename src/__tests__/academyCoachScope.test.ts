import { describe, it, expect, vi, beforeEach } from 'vitest';

// Two coaches, one trainee each, and a club runner. Every read is filtered the
// way PostgREST would filter it.
const athletes = [
  { id: 'dana', name: 'Dana', role: 'academy_coach', coach_id: 'club', is_academy: false, academy_coach_id: null, group_id: null },
  { id: 'guy', name: 'Guy', role: 'academy_coach', coach_id: 'club', is_academy: false, academy_coach_id: null, group_id: null },
  { id: 't1', name: 'Yoav', role: 'runner', coach_id: 'club', is_academy: true, academy_coach_id: 'dana', group_id: null },
  { id: 't2', name: 'Michal', role: 'runner', coach_id: 'club', is_academy: true, academy_coach_id: 'guy', group_id: null },
];

class Query {
  private rows: Record<string, unknown>[];
  constructor(table: string) {
    this.rows = table === 'athletes' ? athletes.map(a => ({ ...a })) : [];
  }
  select() { return this; }
  eq(col: string, v: unknown) { this.rows = this.rows.filter(r => col === 'coach_id' || r[col] === v); return this; }
  in() { return this; }
  range() { return this; }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }); }
  then(res: (v: unknown) => unknown) { return Promise.resolve({ data: this.rows, error: null }).then(res); }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (t: string) => new Query(t) }),
}));
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), COACH_ID: 'club' }));

const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  requireStaffCaller: (...a: unknown[]) => requireStaffCaller(...a),
}));

const { visibleTraineeIds, mayCoach } = await import('@/lib/academy/pairing-server');
const { GET: statsGET } = await import('@/app/api/academy/stats/route');

const coach = (id: string) => ({ athleteId: id, role: 'academy_coach', roles: [], isStaff: true, isSuperUser: false });
const manager = { athleteId: 'boss', role: 'admin', roles: [], isStaff: true, isSuperUser: true };

describe('academy coach scope', () => {
  beforeEach(() => requireStaffCaller.mockReset());

  it('gives the manager everyone and a coach only their own', async () => {
    expect(await visibleTraineeIds(manager)).toBeNull();
    expect([...(await visibleTraineeIds(coach('dana')))!]).toEqual(['t1']);
    expect([...(await visibleTraineeIds(coach('guy')))!]).toEqual(['t2']);
  });

  it('narrows a manager with ?scope=coach, and nothing widens a coach', async () => {
    const narrowed = await visibleTraineeIds(manager, new Request('http://x/api?scope=coach'));
    expect(narrowed && narrowed.size).toBe(0);
    expect([...(await visibleTraineeIds(coach('dana'), new Request('http://x/api?scope=academy')))!]).toEqual(['t1']);
  });

  it('lets a coach act only for their own trainee', async () => {
    expect(await mayCoach(coach('dana'), 't1')).toBe(true);
    expect(await mayCoach(coach('dana'), 't2')).toBe(false);
    expect(await mayCoach(manager, 't2')).toBe(true);
    expect(await mayCoach({ ...coach('t2'), isStaff: false }, 't2')).toBe(true);
  });

  it('stats: a coach sees only their trainees', async () => {
    requireStaffCaller.mockResolvedValue({ denied: null, caller: coach('dana') });
    const body = await (await statsGET(new Request('http://x/api/academy/stats'))).json();
    expect(body.athletes.map((a: { athleteId: string }) => a.athleteId)).toEqual(['t1']);
    requireStaffCaller.mockResolvedValue({ denied: null, caller: manager });
    const all = await (await statsGET(new Request('http://x/api/academy/stats'))).json();
    expect(all.athletes.map((a: { athleteId: string }) => a.athleteId).sort()).toEqual(['t1', 't2']);
  });
});
