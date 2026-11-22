// Strava callback, link mode. FIXTURE only: the token exchange is a fetch stub and
// the DB is in memory. No OAuth, no real token, no real key (a dummy test key).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

const db = createMemoryDb({
  schema: {
    app_settings: ['key', 'value', 'updated_at'],
    athletes: ['id', 'garmin_auth', 'strava_auth', 'strava_athlete_id', 'strava_enabled', 'data_source', 'avatar_url'],
  },
  unique: { app_settings: [['key']] },
});
let clientImpl: () => unknown = () => db.client;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => clientImpl() }));
const adminSpy = vi.fn(() => { throw new Error('login-mode client touched'); });
vi.mock('@supabase/supabase-js', () => ({ createClient: () => adminSpy() }));

import { signLinkState, reserveLinkState } from '@/lib/strava/link-state';

const VICTIM = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const STRAVA_OK = { access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, athlete: { id: 777, firstname: 'X', lastname: 'Y' } };
const fetchSpy = vi.fn(async (_u: unknown) => new Response(JSON.stringify(STRAVA_OK), { status: 200 }));
const env: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ['ENCRYPTION_KEY', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET']) env[k] = process.env[k];
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32); // dummy 32-byte hex test key
  process.env.STRAVA_CLIENT_ID = 'test-client';
  process.env.STRAVA_CLIENT_SECRET = 'test-secret';
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear(); adminSpy.mockClear(); db.log.length = 0;
  clientImpl = () => db.client;
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify(STRAVA_OK), { status: 200 }));
  db.tables.app_settings.length = 0; db.tables.athletes.length = 0;
  for (const id of [VICTIM, OTHER]) db.tables.athletes.push({ id, garmin_auth: null, strava_auth: null, strava_athlete_id: null, strava_enabled: false, data_source: 'garmin', avatar_url: null });
});
afterEach(() => { for (const [k, v] of Object.entries(env)) process.env[k] = v; vi.unstubAllGlobals(); });

async function callback(state: string | null, code: string | null = 'c') {
  const { GET } = await import('@/app/api/strava/callback/route');
  const u = new URL('https://www.madregot.app/api/strava/callback');
  if (code) u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  return GET(new Request(u));
}
const where = (r: Response) => { const l = new URL(r.headers.get('location')!); return l.pathname + l.search; };
const reserved = async (id = VICTIM) => { const st = signLinkState(id)!; expect(await reserveLinkState(db.client, st, id)).toBe(true); return st; };
const row = (id: string) => db.tables.athletes.find((a) => a.id === id)!;
const athleteWrites = () => db.log.filter((q) => q.table === 'athletes' && q.op !== 'select');

describe('Strava callback, link mode', () => {
  it.each([
    ['a raw athlete id (the old state)', () => VICTIM],
    ['a forged signature', () => signLinkState(VICTIM)!.slice(0, -3) + 'AAA'],
    ['a malformed link. state', () => 'link.x.y'],
    ['an expired state', () => signLinkState(VICTIM, Math.floor(Date.now() / 1000) - 3600)!],
    ['an invalid join: token', () => 'join:not-a-token'],
  ])('%s -> bad_state; no token exchange, no DB access at all', async (_n, mk) => {
    const r = await callback(mk());
    expect(where(r)).toBe('/dashboard/profile?tab=datasource&strava=error&reason=bad_state');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.log).toHaveLength(0);
  });
  it('a correctly SIGNED state that was never reserved -> bad_state, no exchange, no athlete write', async () => {
    expect(where(await callback(signLinkState(VICTIM)!))).toBe('/dashboard/profile?tab=datasource&strava=error&reason=bad_state');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(athleteWrites()).toHaveLength(0);
  });
  it('a reservation for ANOTHER athlete does not validate this state', async () => {
    const st = signLinkState(VICTIM)!;
    await reserveLinkState(db.client, st, OTHER);
    expect(where(await callback(st))).toBe('/dashboard/profile?tab=datasource&strava=error&reason=bad_state');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('missing code or state -> missing_params, no exchange', async () => {
    expect(where(await callback(null))).toMatch(/^\/\?strava=error&reason=missing_params/);
    expect(where(await callback(await reserved(), null))).toMatch(/^\/\?strava=error&reason=missing_params/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('LEGITIMATE LINK end to end: exchange once, write the Strava id onto the VERIFIED athlete only', async () => {
    const r = await callback(await reserved(VICTIM));
    expect(where(r)).toBe('/dashboard/profile?tab=datasource&strava=connected');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://www.strava.com/oauth/token');
    expect(row(VICTIM)).toMatchObject({ strava_athlete_id: 777, strava_enabled: true, data_source: 'strava' });
    expect(row(VICTIM).strava_auth).toEqual(expect.any(String));
    expect(JSON.stringify(row(VICTIM).strava_auth)).not.toContain('"at"');
    expect(row(OTHER)).toMatchObject({ strava_athlete_id: null, strava_auth: null });
    expect(db.tables.app_settings).toHaveLength(0);
  });
  it('REPLAY: the same state a second time -> bad_state, no second exchange, no second write', async () => {
    const st = await reserved(VICTIM);
    await callback(st);
    row(VICTIM).strava_athlete_id = 'kept';
    const r = await callback(st);
    expect(where(r)).toBe('/dashboard/profile?tab=datasource&strava=error&reason=bad_state');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(row(VICTIM).strava_athlete_id).toBe('kept');
  });
  it('a Garmin athlete keeps data_source garmin when Strava is linked', async () => {
    row(VICTIM).garmin_auth = 'enc';
    await callback(await reserved(VICTIM));
    expect(row(VICTIM).data_source).toBe('garmin');
  });
  it('a login state is not subject to the link guard (reaches the exchange; login mode is out of scope here)', async () => {
    await callback('login');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('the store failing while consuming -> link_unavailable (still fail closed, no exchange)', async () => {
    const st = await reserved(VICTIM);
    clientImpl = () => ({ from: () => ({ delete: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: null, error: { code: 'X' } }) }) }) }) }) });
    expect(where(await callback(st))).toBe('/dashboard/profile?tab=datasource&strava=error&reason=link_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('a synchronous client failure is a redirect, not a bare 500', async () => {
    const st = await reserved(VICTIM);
    clientImpl = () => { throw new Error('supabaseUrl is required.'); };
    const r = await callback(st);
    expect(r.status).toBe(307);
    expect(where(r)).toBe('/dashboard/profile?tab=datasource&strava=error&reason=link_unavailable');
  });
  it('a transient exchange failure restores the reservation, so the same callback can be retried', async () => {
    const st = await reserved(VICTIM);
    fetchSpy.mockImplementationOnce(async () => new Response('upstream down', { status: 502 }));
    await callback(st);
    expect(row(VICTIM).strava_athlete_id).toBeNull();
    expect(db.tables.app_settings).toHaveLength(1);
    expect(where(await callback(st))).toBe('/dashboard/profile?tab=datasource&strava=connected');
    expect(row(VICTIM).strava_athlete_id).toBe(777);
  });
  it('an INVALID code is not restored: it cannot succeed on a retry', async () => {
    const st = await reserved(VICTIM);
    fetchSpy.mockImplementationOnce(async () => new Response(JSON.stringify({ errors: [{ code: 'invalid' }] }), { status: 400 }));
    await callback(st);
    expect(db.tables.app_settings).toHaveLength(0);
  });
});
