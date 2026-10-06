import { describe, it, expect, vi, beforeEach } from 'vitest';

// app_settings, athletes and the funnel, filtered the way PostgREST would.
const db: Record<string, Record<string, unknown>[]> = {};
const upserts: Record<string, unknown>[] = [];

class Query {
  private rows: Record<string, unknown>[];
  constructor(private table: string) { this.rows = (db[table] || []).map(r => ({ ...r })); }
  select() { return this; }
  eq(col: string, v: unknown) { this.rows = this.rows.filter(r => col === 'coach_id' || r[col] === v); return this; }
  upsert(row: Record<string, unknown>) { upserts.push(row); return Promise.resolve({ error: null }); }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }); }
  then(res: (v: unknown) => unknown) { return Promise.resolve({ data: this.rows, error: null }).then(res); }
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));

const requireAcademyManager = vi.fn();
vi.mock('@/lib/academy/pairing-server', () => ({ requireAcademyManager: (...a: unknown[]) => requireAcademyManager(...a) }));

const { parseRegistrationOpen, mayRegister, isRegistrationOpen } = await import('@/lib/academy/registration');
const { academyCoachIds, holdsAcademyCoachRole } = await import('@/lib/academy/coaches');
const registration = await import('@/app/api/academy/registration/route');
const summary = await import('@/app/api/academy/summary/route');

const asManager = () => requireAcademyManager.mockResolvedValue({ denied: null, caller: {} });
const asCoach = () => requireAcademyManager.mockResolvedValue({ denied: new Response('no', { status: 403 }), caller: {} });

beforeEach(() => {
  db.app_settings = [];
  db.academy_candidates = [{ id: 'c1', name: 'Raz', athlete_id: null, archived_at: null, created_at: '2026-10-01T08:00:00Z', invite_token: 'tok-live' },
    { id: 'c2', name: 'Gone', athlete_id: null, archived_at: '2026-10-02T08:00:00Z', created_at: '2026-09-01T08:00:00Z', invite_token: 'tok-archived' }];
  db.academy_candidate_events = [];
  db.athletes = [
    { id: 'dana', role: 'academy_coach', extra_roles: null, is_academy: false, approved: true, academy_coach_id: null },
    { id: 'guy', role: 'runner', extra_roles: ['academy_coach'], is_academy: false, approved: true, academy_coach_id: null },
    { id: 'boss', role: 'admin', extra_roles: null, is_academy: false, approved: true, academy_coach_id: null },
    { id: 't1', role: 'runner', extra_roles: null, is_academy: true, approved: true, academy_coach_id: 'dana' },
    { id: 't2', role: 'runner', extra_roles: null, is_academy: true, approved: true, academy_coach_id: null },
    { id: 'p1', role: 'runner', extra_roles: null, is_academy: true, approved: false, academy_coach_id: null },
  ];
  upserts.length = 0;
  requireAcademyManager.mockReset();
});

describe('the registration switch', () => {
  it('is open unless it says closed, so a typo never shuts the academy', () => {
    expect(parseRegistrationOpen(undefined)).toBe(true);
    expect(parseRegistrationOpen('open')).toBe(true);
    expect(parseRegistrationOpen('Closed ')).toBe(true);
    expect(parseRegistrationOpen('closed')).toBe(false);
  });

  it('with no row is open, as the old constants were', async () => {
    expect(await isRegistrationOpen((await import('@/lib/supabase/server')).createServerClient())).toBe(true);
  });

  it('closed: only a live personal invitation gets through', async () => {
    db.app_settings = [{ key: 'academy_registration_open', value: 'closed' }];
    const sb = (await import('@/lib/supabase/server')).createServerClient();
    expect(await mayRegister(sb, null)).toBe(false);
    expect(await mayRegister(sb, 'tok-live')).toBe(true);
    expect(await mayRegister(sb, 'tok-archived')).toBe(false);
    expect(await mayRegister(sb, 'nope')).toBe(false);
  });

  it('GET answers anyone, PUT is the manager\'s', async () => {
    const res = await (await registration.GET(new Request('http://x/api/academy/registration'))).json();
    expect(res).toEqual({ open: true, canRegister: true });

    asCoach();
    const denied = await registration.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ open: false }) }));
    expect(denied.status).toBe(403);
    expect(upserts).toHaveLength(0);

    asManager();
    const bad = await registration.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ open: 'no' }) }));
    expect(bad.status).toBe(400);
    const ok = await registration.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ open: false }) }));
    expect(ok.status).toBe(200);
    expect(upserts[0]).toMatchObject({ key: 'academy_registration_open', value: 'closed' });
  });
});

describe('who counts as an academy coach', () => {
  it('the role, primary or extra, and anyone already holding a trainee', () => {
    expect(holdsAcademyCoachRole({ id: 'a', role: 'academy_coach' })).toBe(true);
    expect(holdsAcademyCoachRole({ id: 'a', role: 'runner', extra_roles: ['academy_coach'] })).toBe(true);
    expect(holdsAcademyCoachRole({ id: 'a', role: 'admin' })).toBe(false);
    const ids = academyCoachIds([{ id: 'dana', role: 'academy_coach' }, { id: 'boss', role: 'admin' }], [{ academy_coach_id: 'boss' }]);
    expect([...ids].sort()).toEqual(['boss', 'dana']);
  });
});

describe('the control room summary', () => {
  it('is the manager\'s', async () => {
    asCoach();
    expect((await summary.GET(new Request('http://x/api/academy/summary'))).status).toBe(403);
  });

  it('counts approved trainees, academy coaches, the unpaired and the live funnel', async () => {
    asManager();
    const body = await (await summary.GET(new Request('http://x/api/academy/summary'))).json();
    expect(body).toEqual({ trainees: 2, coaches: 2, unpaired: 1, inFunnel: 1, registrationOpen: true });
  });
});
