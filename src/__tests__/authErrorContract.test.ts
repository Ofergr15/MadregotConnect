import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Auth error CONTRACT for native clients (docs/contracts/auth-errors.md): what each failure of
 * requireSession means, so a client can tell "this token is dead → refresh, then sign in" from
 * "the auth service hiccuped → retry later, keep the session".
 */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number) => `${b64({ alg: 'HS256' })}.${b64({ exp, sub: 'u' })}.sig`;
const future = () => jwt(Math.floor(Date.now() / 1000) + 3600 + Math.floor(Math.random() * 1e6));

let getUser: () => Promise<unknown>;
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: () => getUser() } }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    const c: any = {};
    for (const m of ['select', 'eq', 'ilike', 'in', 'or', 'is', 'limit', 'order']) c[m] = () => c;
    c.maybeSingle = async () => ({ data: null, error: null });
    c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
    return { from: () => c };
  },
}));
const { requireSession } = await import('@/lib/auth-session');
const req = (token?: string) => new Request('http://x/api/feed', { headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('requireSession error contract', () => {
  it('no bearer → 401 "Missing bearer token" (definitive: sign in)', async () => {
    expect(await requireSession(req())).toMatchObject({ ok: false, status: 401, error: 'Missing bearer token' });
  });
  it('JWT past its exp → 401, without calling Supabase (definitive: refresh)', async () => {
    getUser = vi.fn();
    expect(await requireSession(req(jwt(1000)))).toMatchObject({ ok: false, status: 401, error: 'Invalid or expired session' });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('Supabase rejects the token (4xx) → 401 (definitive: refresh, then sign in)', async () => {
    getUser = async () => ({ data: null, error: { status: 403, message: 'bad jwt' } });
    expect(await requireSession(req(future()))).toMatchObject({ ok: false, status: 401 });
  });
  it.each([429, 500, 502, 503])('Supabase answers %i → 503 "try again" (transient: keep the session)', async (s) => {
    getUser = async () => ({ data: null, error: { status: s, message: 'x' } });
    expect(await requireSession(req(future()))).toMatchObject({ ok: false, status: 503, error: 'Could not verify session, try again' });
  });
  it('network failure reaching Supabase → 503 (transient)', async () => {
    getUser = async () => { throw new Error('ECONNRESET'); };
    expect(await requireSession(req(future()))).toMatchObject({ ok: false, status: 503 });
  });
  it('valid token but no club membership → 403 (not a session problem: do not sign out-loop)', async () => {
    getUser = async () => ({ data: { user: { email: 'nobody@example.com' } }, error: null });
    expect(await requireSession(req(future()))).toMatchObject({ ok: false, status: 403, error: 'No membership found for this account' });
  });
  it('server misconfigured → 500 (not the client\'s fault)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(await requireSession(req(future()))).toMatchObject({ ok: false, status: 500 });
  });
});
