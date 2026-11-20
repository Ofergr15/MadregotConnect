// The callback refuses a link state that this server did not sign for this browser
// BEFORE any Strava token exchange or DB access. FIXTURE only: fetch and the DB
// clients are spies; no OAuth, no real token, no real key (a dummy test key).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'should not be called' }), { status: 500 }));
const dbSpy = vi.fn(() => { throw new Error('db touched'); });
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => dbSpy() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => dbSpy() }));

import { signLinkState, linkBindingOf, LINK_COOKIE } from '@/lib/strava/link-state';

const ID = '00000000-0000-4000-8000-000000000001';
const env: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['ENCRYPTION_KEY', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET']) env[k] = process.env[k];
  process.env.ENCRYPTION_KEY = 't'.repeat(40);
  process.env.STRAVA_CLIENT_ID = 'test-client';
  process.env.STRAVA_CLIENT_SECRET = 'test-secret';
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear(); dbSpy.mockClear();
});
afterEach(() => { for (const [k, v] of Object.entries(env)) process.env[k] = v; vi.unstubAllGlobals(); });

async function callback(state: string | null, cookie?: string, code: string | null = 'c') {
  const { GET } = await import('@/app/api/strava/callback/route');
  const u = new URL('https://www.madregot.app/api/strava/callback');
  if (code) u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  return GET(new Request(u, cookie ? { headers: { cookie: `${LINK_COOKIE}=${cookie}` } } : {}));
}
const where = (r: Response) => new URL(r.headers.get('location')!).pathname + new URL(r.headers.get('location')!).search;

describe('Strava callback, link mode, refused before exchange', () => {
  const good = () => signLinkState(ID)!;
  it.each([
    ['a raw athlete id (the old state)', () => [ID, undefined] as const],
    ['a forged signature', () => [good().slice(0, -3) + 'AAA', linkBindingOf(good())!] as const],
    ['a malformed link. state', () => ['link.x.y', 'z'] as const],
    ['an expired state', () => { const st = signLinkState(ID, Math.floor(Date.now() / 1000) - 3600)!; return [st, linkBindingOf(st)!] as const; }],
    ['a valid state WITHOUT the browser cookie', () => [good(), undefined] as const],
    ['a valid state with ANOTHER state\'s cookie', () => [good(), linkBindingOf(good())!] as const],
    ['an invalid join: token', () => ['join:not-a-token', undefined] as const],
  ])('%s -> bad_state; no token exchange, no DB', async (_n, mk) => {
    const [st, ck] = mk();
    const r = await callback(st, ck);
    expect(where(r)).toBe('/dashboard/athletes?strava=error&reason=bad_state');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dbSpy).not.toHaveBeenCalled();
    expect(r.headers.get('set-cookie') ?? '').toContain(`${LINK_COOKIE}=`);
  });
  it('missing code or state -> missing_params, no exchange', async () => {
    expect(where(await callback(null))).toMatch(/^\/\?strava=error&reason=missing_params/);
    expect(where(await callback(good(), undefined, null))).toMatch(/^\/\?strava=error&reason=missing_params/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('a valid state WITH its cookie gets past the guard (reaches the exchange)', async () => {
    const st = good();
    await callback(st, linkBindingOf(st)!);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('https://www.strava.com/oauth/token');
  });
  it('a login state is not subject to the link guard (reaches the exchange)', async () => {
    await callback('login');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
