import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Academy home routes: hub narrows (never 403s a member of the academy for asking wider),
 * self-report is self only, assign is manager only, benchmark-zones is self/coach/manager.
 * Real gates run; only the session and DB are faked.
 */
let user: any;
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));
const readHub = vi.fn(async (o: any) => ({ view: o.view, views: o.views }));
vi.mock('@/lib/academy/hub-server', () => ({ readHub: (o: any) => readHub(o) }));
const setPair = vi.fn(async () => ({ ok: true, added: [], removed: [] }));
let isAcademy = true;
const upserts: any[] = [];
vi.mock('@/lib/academy/trainee-coaches', () => ({
  coachIdsByTrainee: async () => new Map([['t1', ['c1']], ['t2', ['c1']]]),
  traineeIdsOfCoach: async () => ['t1'],
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q,
        upsert: async (r: any) => { upserts.push(r); return { error: null }; },
        maybeSingle: async () => ({ data: { is_academy: isAcademy }, error: null }),
        then: (ok: any) => Promise.resolve({ data: [{ id: 't1' }, { id: 't2' }], error: null }).then(ok),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/academy/thread-server', () => ({ syncAcademyThreadCoaches: async () => {} }));

const pairing = await import('@/lib/academy/pairing-server');
vi.spyOn(pairing, 'setPairCoaches').mockImplementation(setPair as any);
vi.spyOn(pairing, 'mayCoach').mockImplementation(async (c: any, id: string) => c.athleteId === id || c.role === 'admin');

const trainee = { email: 't@x', isSuperUser: false, canApprove: false, isStaff: false, athleteId: 't1', role: 'runner', isCoreRunner: false };
const coach = { ...trainee, athleteId: 'c1', role: 'academy_coach', isStaff: true };
const manager = { ...coach, athleteId: 'm1', roles: ['academy_coach', 'academy_manager'] };

const req = (url: string, body?: unknown) =>
  new Request(`http://x${url}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { authorization: 'Bearer t' } });

const hub = await import('@/app/api/academy/hub/route');
const selfReport = await import('@/app/api/academy/self-report/route');
const assign = await import('@/app/api/academy/assign/route');
const zones = await import('@/app/api/academy/benchmark-zones/route');

beforeEach(() => { readHub.mockClear(); setPair.mockClear(); upserts.length = 0; isAcademy = true; });

describe('GET /api/academy/hub', () => {
  it('a trainee asking for manager gets trainee', async () => {
    user = trainee;
    const r = await hub.GET(req('/api/academy/hub?view=manager'));
    expect((await r.json()).view).toBe('trainee');
  });
  it('a coach asking for manager gets coach, scoped to their pairs', async () => {
    user = coach; isAcademy = false;
    const r = await hub.GET(req('/api/academy/hub?view=manager'));
    expect((await r.json()).view).toBe('coach');
    expect([...readHub.mock.calls[0][0].scope]).toEqual(['t1']);
  });
  it('manager lands on manager with no scope, and can switch to coach', async () => {
    user = manager; isAcademy = false;
    expect((await (await hub.GET(req('/api/academy/hub'))).json()).view).toBe('manager');
    expect(readHub.mock.calls[0][0].scope).toBeNull();
    expect((await (await hub.GET(req('/api/academy/hub?view=coach'))).json()).view).toBe('coach');
  });
  it('a club member outside the academy is refused', async () => {
    user = trainee; isAcademy = false;
    expect((await hub.GET(req('/api/academy/hub'))).status).toBe(403);
  });
});

describe('POST /api/academy/self-report', () => {
  it('writes as the caller, ignoring a body athleteId', async () => {
    user = trainee;
    const r = await selfReport.POST(req('/api/academy/self-report', { athleteId: 't2', workoutDate: '2026-11-18', rpe: 7 }));
    expect(r.status).toBe(200);
    expect(upserts[0].athlete_id).toBe('t1');
  });
  it('refuses a non-academy caller and bad input', async () => {
    user = trainee;
    expect((await selfReport.POST(req('/api/academy/self-report', { workoutDate: '2026-11-18', rpe: 0 }))).status).toBe(400);
    isAcademy = false;
    expect((await selfReport.POST(req('/api/academy/self-report', { workoutDate: '2026-11-18', rpe: 5 }))).status).toBe(403);
  });
});

describe('POST /api/academy/assign', () => {
  it('a coach can never assign', async () => {
    user = coach;
    expect((await assign.POST(req('/api/academy/assign', { athleteId: 't1', coachIds: ['c1'] }))).status).toBe(403);
    expect(setPair).not.toHaveBeenCalled();
  });
  it('the manager can', async () => {
    user = manager;
    const r = await assign.POST(req('/api/academy/assign', { athleteId: 't2', coachIds: ['c1'] }));
    expect(r.status).toBe(200);
    expect(setPair).toHaveBeenCalledWith('t2', ['c1'], null);
  });
});

describe('GET /api/academy/benchmark-zones', () => {
  it('self yes, another trainee no', async () => {
    user = trainee;
    expect((await zones.GET(req('/api/academy/benchmark-zones?athleteId=t1&time=7:41'))).status).toBe(200);
    expect((await zones.GET(req('/api/academy/benchmark-zones?athleteId=t2&time=7:41'))).status).toBe(403);
  });
});
