import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the two Track A READ routes a native client may call:
 *  - GET /api/u21/registrations      (admin list; docs/contracts/u21-register.md "Admin list")
 *  - GET /api/academy/register?i=…    (personal-link prefill; docs/contracts/academy-register.md)
 * The real handlers and the real invitePrefill run; only auth and the DB are faked.
 */

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (p: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(p)}.sig`;
const REF = 'rtcgklespcwvxashhamh';
const approved = () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${REF}.supabase.co`);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', fakeJwt({ role: 'service_role', ref: REF }));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', fakeJwt({ role: 'anon', ref: REF }));
};

let who: { isSuperUser: boolean; role: string; isStaff?: boolean } | null = null;
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => (who
    ? { denied: null, caller: who }
    : { denied: Response.json({ error: 'Authentication required' }, { status: 401 }), caller: {} }),
}));
let answer: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    const c: any = {};
    for (const m of ['select', 'eq', 'order']) c[m] = () => c;
    c.limit = async () => answer;
    c.maybeSingle = async () => answer;
    return { from: () => c };
  },
}));

const { GET: list } = await import('@/app/api/u21/registrations/route');
const { GET: prefill } = await import('@/app/api/academy/register/route');

const ROW = { id: 'r1', first_name: 'בדיקה', last_name: 'סינתטי', age_band: '18-21', track: 'basic', red_flag: false, status: 'pending_review', created_at: '2026-11-19T10:00:00Z' };
const TOKEN = 'ab'.repeat(16);

beforeEach(() => { approved(); who = null; answer = { data: null, error: null }; });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('GET /api/u21/registrations', () => {
  it('admin → 200 { data: Row[], ready: true }, rows carry exactly the 8 list keys', async () => {
    who = { isSuperUser: false, role: 'admin' };
    answer = { data: [ROW], error: null };
    const body = await (await list(new Request('http://x'))).json();
    expect(body).toEqual({ data: [ROW], ready: true });
    expect(Object.keys(body.data[0]).sort()).toEqual(['age_band', 'created_at', 'first_name', 'id', 'last_name', 'red_flag', 'status', 'track']);
  });
  it('empty → { data: [], ready: true }; migration 199 missing → { data: [], ready: false }', async () => {
    who = { isSuperUser: true, role: 'runner' };
    expect(await (await list(new Request('http://x'))).json()).toEqual({ data: [], ready: true });
    answer = { data: null, error: { code: '42P01' } };
    expect(await (await list(new Request('http://x'))).json()).toEqual({ data: [], ready: false });
  });
  it('no session → 401; a coach (staff, not admin) → 403 { error: "forbidden" }', async () => {
    expect((await list(new Request('http://x'))).status).toBe(401);
    who = { isSuperUser: false, role: 'coach', isStaff: true };
    const res = await list(new Request('http://x'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });
  it('a DB error → 500 { error: "Could not load" }', async () => {
    who = { isSuperUser: false, role: 'admin' };
    answer = { data: null, error: { code: 'XX000', message: 'secret detail' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await (await list(new Request('http://x'))).json()).toEqual({ error: 'Could not load' });
  });
  it('not the approved env → 503 before auth is even read (intentional)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    who = { isSuperUser: true, role: 'admin' };
    const res = await list(new Request('http://x'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Service unavailable' });
  });
});

describe('GET /api/academy/register?i=<token>', () => {
  const get = (q: string) => prefill(new Request(`http://x/api/academy/register${q}`));
  const fresh = new Date().toISOString();
  it('a live new-applicant link → { prefill: { name, email, phone, existing: false } }', async () => {
    answer = { data: { name: 'דניאל', email: 'd@x.com', phone: null, source: 'instagram', invited_at: fresh, archived_at: null, intake: null }, error: null };
    expect(await (await get(`?i=${TOKEN}`)).json()).toEqual({ prefill: { name: 'דניאל', email: 'd@x.com', phone: '', existing: false } });
  });
  it('an existing trainee’s link → existing: true', async () => {
    answer = { data: { name: 'a', email: 'b', phone: 'c', source: 'existing', invited_at: fresh, archived_at: null, intake: null }, error: null };
    expect((await (await get(`?i=${TOKEN}`)).json()).prefill.existing).toBe(true);
  });
  it.each([
    ['no token', ''],
    ['malformed token', '?i=nothex'],
  ])('%s → { prefill: null } (200)', async (_l, q) => {
    const res = await get(q);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prefill: null });
  });
  it('unknown or stale token → { prefill: null }', async () => {
    expect(await (await get(`?i=${TOKEN}`)).json()).toEqual({ prefill: null });
    answer = { data: { name: 'a', email: 'b', phone: 'c', source: 'x', invited_at: '2020-01-01T00:00:00Z', archived_at: null }, error: null };
    expect(await (await get(`?i=${TOKEN}`)).json()).toEqual({ prefill: null });
  });
});
