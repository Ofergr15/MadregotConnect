// S2: a Strava login may not ADOPT a roster row on a name alone when that row is
// privileged or already linked to a different Strava account. FIXTURE only: the
// token exchange is a fetch stub, the DB is in memory, sessions are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { nameAdoptionRefusal, isPrivilegedRow } from '@/lib/auth/athlete-identity';

const ATH_COLS = ['id', 'name', 'email', 'role', 'status', 'approved', 'created_at', 'strava_athlete_id', 'strava_auth', 'garmin_auth',
  'strava_enabled', 'data_source', 'avatar_url', 'coach_id', 'extra_roles', 'is_super_user', 'is_approver', 'approved_at', 'onboarding_status', 'group_id'];
const db = createMemoryDb({
  schema: {
    athletes: ATH_COLS,
    signup_requests: ['id', 'athlete_id', 'full_name', 'email', 'status'],
    coaches: ['id', 'email', 'name'],
    login_handoffs: ['challenge', 'auth_email', 'created_at', 'expires_at', 'claimed_at'],
  },
  defaults: { athletes: () => ({ id: `new-${Math.random().toString(16).slice(2)}`, created_at: new Date().toISOString() }) },
});
let mode: 'guarded' | 'never' = 'guarded';
vi.mock('@/lib/auth/athlete-identity', async (orig) => {
  const real = await orig<typeof import('@/lib/auth/athlete-identity')>();
  return { ...real, get NAME_ADOPTION_MODE() { return mode; } };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.client }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const sessions: string[] = [];
vi.mock('@/lib/auth/synthetic-session', () => ({
  createSyntheticSession: async (_a: unknown, email: string) => { sessions.push(email); return { session: { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' }, error: null }; },
}));
vi.mock('@/lib/auth/merge-athletes', () => ({ mergeAthleteRows: async () => ({ merged: false }) }));
vi.mock('@/lib/signup-queue', () => ({ queuePendingStravaSignup: async () => {} }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: async () => {}, deviceFromUa: () => null }));

let stravaAthlete = { id: 9001, firstname: 'Dana', lastname: 'Levi' };
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, athlete: stravaAthlete }), { status: 200 }));
const env: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['ENCRYPTION_KEY', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'NEXT_PUBLIC_SUPABASE_URL']) env[k] = process.env[k];
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32); // dummy hex test key
  process.env.STRAVA_CLIENT_ID = 'test-client'; process.env.STRAVA_CLIENT_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  vi.stubGlobal('fetch', fetchSpy);
  for (const t of Object.values(db.tables)) t.length = 0;
  sessions.length = 0;
  mode = 'guarded';
});
afterEach(() => { for (const [k, v] of Object.entries(env)) process.env[k] = v; vi.unstubAllGlobals(); });

const member = (over: Record<string, unknown>) => ({ role: 'runner', status: 'active', approved: true, created_at: '2026-01-01', strava_athlete_id: null,
  strava_auth: null, garmin_auth: null, extra_roles: [], is_super_user: false, is_approver: false, ...over });
async function login() {
  const { GET } = await import('@/app/api/strava/callback/route');
  return GET(new Request('https://www.madregot.app/api/strava/callback?code=c&state=login'));
}
const row = (id: string) => db.tables.athletes.find((a) => a.id === id)!;

describe('S2 rule (unit)', () => {
  const base = { id: 'x', role: 'runner', strava_athlete_id: null };
  it('guarded: an ordinary unlinked member may be adopted', () => expect(nameAdoptionRefusal(base, 1, false, 'guarded')).toBeNull());
  it('guarded: a row linked to ANOTHER Strava id is refused; the same id is fine', () => {
    expect(nameAdoptionRefusal({ ...base, strava_athlete_id: 2 }, 1, false, 'guarded')).toBe('linked_to_other_strava');
    expect(nameAdoptionRefusal({ ...base, strava_athlete_id: 1 }, 1, false, 'guarded')).toBeNull();
  });
  it('guarded: staff role, extra staff role, super-user, approver are refused', () => {
    for (const role of ['admin', 'coach', 'academy_coach']) expect(nameAdoptionRefusal({ ...base, role }, 1, false, 'guarded')).toBe('privileged_row');
    expect(nameAdoptionRefusal(base, 1, isPrivilegedRow({ extra_roles: ['coach'] }), 'guarded')).toBe('privileged_row');
    expect(nameAdoptionRefusal(base, 1, isPrivilegedRow({ is_super_user: true }), 'guarded')).toBe('privileged_row');
    expect(nameAdoptionRefusal(base, 1, isPrivilegedRow({ is_approver: true }), 'guarded')).toBe('privileged_row');
  });
  it('guarded: unreadable privilege flags are refused (fail closed)', () => expect(nameAdoptionRefusal(base, 1, null, 'guarded')).toBe('privileges_unknown'));
  it('never: no name-only adoption at all', () => expect(nameAdoptionRefusal(base, 1, false, 'never')).toBe('name_only_disabled'));
});

describe('S2 at the callback (login mode)', () => {
  it('TAKEOVER BLOCKED: a Strava account renamed to the coach\'s exact name does not adopt the coach row', async () => {
    db.tables.athletes.push(member({ id: 'coach', name: 'Dana Levi', email: 'coach@example.test', role: 'coach' }));
    await login();
    expect(row('coach').strava_athlete_id).toBeNull();
    expect(row('coach').strava_auth).toBeNull();
    const created = db.tables.athletes.find((a) => a.id !== 'coach');
    expect(created).toMatchObject({ strava_athlete_id: 9001, approved: false, role: 'runner' });
  });
  it('TAKEOVER BLOCKED: a super-user runner row (the owner shape) is not adopted by name', async () => {
    db.tables.athletes.push(member({ id: 'owner', name: 'Dana Levi', email: 'owner@example.test', is_super_user: true }));
    await login();
    expect(row('owner').strava_athlete_id).toBeNull();
  });
  it('TAKEOVER BLOCKED: a member already linked to a DIFFERENT Strava id is not re-linked by name', async () => {
    db.tables.athletes.push(member({ id: 'm', name: 'Dana Levi', email: 'm@example.test', strava_athlete_id: 1234, strava_auth: 'enc-old' }));
    await login();
    expect(row('m')).toMatchObject({ strava_athlete_id: 1234, strava_auth: 'enc-old' });
  });
  it('COMPATIBILITY: an ordinary unlinked member\'s FIRST Strava login still adopts their row by exact name', async () => {
    db.tables.athletes.push(member({ id: 'm', name: 'Dana Levi', email: 'm@example.test' }));
    await login();
    expect(row('m').strava_athlete_id).toBe(9001);
    expect(db.tables.athletes).toHaveLength(1);
  });

  it('RECLAIM BLOCKED: a shell already carrying this Strava id cannot reclaim the coach row by name', async () => {
    db.tables.athletes.push(
      member({ id: 'shell', name: 'Dana Levi', email: 'strava_9001@strava.madregot.local', strava_athlete_id: 9001, approved: false, status: 'invited' }),
      member({ id: 'coach', name: 'Dana Levi', email: 'coach@example.test', role: 'coach' }),
    );
    await login();
    expect(row('coach').strava_athlete_id).toBeNull();
    expect(row('coach').strava_auth).toBeNull();
  });
});

describe("S2 'never' mode: NO name-only adoption on any of the four paths", () => {
  beforeEach(() => { mode = 'never'; });
  it('exact active name (matchAthleteByName)', async () => {
    db.tables.athletes.push(member({ id: 'm', name: 'Dana Levi', email: 'm@example.test' }));
    await login();
    expect(row('m').strava_athlete_id).toBeNull();
    expect(db.tables.athletes.find((a) => a.id !== 'm')).toMatchObject({ strava_athlete_id: 9001, approved: false });
  });
  it('cross-script name key (matchAthleteByNameKey)', async () => {
    db.tables.athletes.push(member({ id: 'm', name: 'דנה לוי', email: 'm@example.test' }));
    await login();
    expect(row('m').strava_athlete_id).toBeNull();
  });
  it('real row, any status (matchRealRowByName)', async () => {
    db.tables.athletes.push(member({ id: 'm', name: 'Dana Levi', email: 'm@example.test', status: 'invited' }));
    await login();
    expect(row('m').strava_athlete_id).toBeNull();
  });
  it('reclaim after a shell matched by Strava id', async () => {
    db.tables.athletes.push(
      member({ id: 'shell', name: 'Dana Levi', email: 'strava_9001@strava.madregot.local', strava_athlete_id: 9001, approved: false, status: 'invited' }),
      member({ id: 'm', name: 'Dana Levi', email: 'm@example.test' }),
    );
    await login();
    expect(row('m').strava_athlete_id).toBeNull();
  });
  it('a row ALREADY linked to this Strava id still signs in (identity, not name)', async () => {
    db.tables.athletes.push(member({ id: 'm', name: 'Someone Else', email: 'm@example.test', strava_athlete_id: 9001, strava_auth: 'enc' }));
    await login();
    expect(db.tables.athletes).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });
});
