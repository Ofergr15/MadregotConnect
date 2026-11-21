// Strava callback, LOGIN mode: who does "Sign in with Strava" make you? FIXTURE only: the
// token exchange is a fetch stub, the DB is in memory, the session is a stub. No real
// account, token, key or member is touched.
//
// The three journeys the owner reviewed (2026-11-21 09:51 proposal):
//  1. a member whose Strava is ALREADY linked keeps signing in as today;
//  2. an existing member linking Strava for the FIRST time is not signed in by name alone —
//     they verify their registered email once (the email-code sign-in) and connect Strava
//     from inside the app, or a coach links them;
//  3. somebody new gets a pending membership, as today.
// Plus the attacks: a Strava display name that equals a member's (or an admin's) name must
// not sign anyone in as that member, and a second login must not "reclaim" them either.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

const COLS = ['id', 'name', 'email', 'role', 'status', 'approved', 'created_at', 'strava_athlete_id', 'strava_auth',
  'garmin_auth', 'strava_enabled', 'data_source', 'avatar_url', 'coach_id'];
const db = createMemoryDb({
  schema: {
    athletes: COLS,
    signup_requests: ['athlete_id', 'full_name'],
    coaches: ['id', 'email', 'name'],
    login_handoffs: ['id', 'challenge', 'auth_email', 'expires_at'],
    onboarding_events: ['id', 'event', 'props', 'created_at', 'device', 'athlete_id', 'email'],
    app_settings: ['key', 'value', 'updated_at'],
  },
  unique: { athletes: [['strava_athlete_id']] },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.client }));
const sessions: string[] = [];
vi.mock('@/lib/auth/synthetic-session', () => ({
  createSyntheticSession: vi.fn(async (_a: unknown, email: string) => {
    sessions.push(email);
    return { session: { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' }, user: { id: 'u' }, error: null };
  }),
}));
const merges: Array<{ duplicateId: string; realId: string }> = [];
vi.mock('@/lib/auth/merge-athletes', () => ({
  mergeAthleteRows: vi.fn(async (_a: unknown, x: { duplicateId: string; realId: string }) => { merges.push(x); return { merged: true }; }),
}));
vi.mock('@/lib/signup-queue', () => ({ queuePendingStravaSignup: vi.fn(async () => undefined) }));
vi.mock('@/lib/onboarding/events', () => ({ deviceFromUa: () => 'test', recordOnbEvent: vi.fn(async () => undefined) }));

const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const ADMIN = '00000000-0000-4000-8000-0000000000a2';
const LINKED = '00000000-0000-4000-8000-0000000000a3';
const INVITED = '00000000-0000-4000-8000-0000000000a4';
const base = { status: 'active', approved: true, created_at: '2026-01-01T00:00:00Z', strava_auth: null, garmin_auth: 'g', strava_enabled: false,
  data_source: 'garmin', avatar_url: null, coach_id: 'c', strava_athlete_id: null };
function seed() {
  db.tables.athletes.length = 0; db.tables.signup_requests.length = 0; db.tables.login_handoffs.length = 0;
  db.tables.athletes.push(
    { ...base, id: MEMBER, name: 'Dana Levi', email: 'dana.levi@example.test', role: 'runner' },
    { ...base, id: ADMIN, name: 'Noa Admin', email: 'noa.admin@example.test', role: 'admin' },
    { ...base, id: LINKED, name: 'Ron Linked', email: 'ron@example.test', role: 'runner', strava_athlete_id: 555, strava_enabled: true },
    { ...base, id: INVITED, name: 'Tal Invited', email: 'tal@example.test', role: 'runner', status: 'invited', approved: true },
  );
}

let athlete = { id: 900, firstname: 'Dana', lastname: 'Levi' };
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, athlete }), { status: 200 }));
const env: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['ENCRYPTION_KEY', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) env[k] = process.env[k];
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32); // dummy test key
  process.env.STRAVA_CLIENT_ID = 'test-client'; process.env.STRAVA_CLIENT_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  vi.stubGlobal('fetch', fetchSpy);
  sessions.length = 0; merges.length = 0; seed();
});
afterEach(() => { for (const [k, v] of Object.entries(env)) process.env[k] = v; vi.unstubAllGlobals(); });

async function login(as: { id: number; firstname: string; lastname: string }) {
  athlete = as;
  const { GET } = await import('@/app/api/strava/callback/route');
  const u = new URL('https://www.madregot.app/api/strava/callback');
  u.searchParams.set('code', 'c'); u.searchParams.set('state', 'login');
  return GET(new Request(u));
}
const where = (r: Response) => { const l = new URL(r.headers.get('location')!); return l.pathname + l.search; };
const row = (id: string) => db.tables.athletes.find((a) => a.id === id)!;

describe('Strava login — journey 1: already linked', () => {
  it('signs in as the linked member, unchanged', async () => {
    const r = await login({ id: 555, firstname: 'Ron', lastname: 'Linked' });
    expect(where(r)).toMatch(/^\/auth\/resolve/);
    expect(sessions).toHaveLength(1);
    expect(row(LINKED).strava_athlete_id).toBe(555);
    expect(db.tables.athletes).toHaveLength(4);                 // no new row
  });
});

describe('Strava login — journey 2: existing member, first Strava link (name match only)', () => {
  it('a Strava account named like a member does NOT sign in as that member, and does not touch their row', async () => {
    const r = await login({ id: 900, firstname: 'Dana', lastname: 'Levi' });
    expect(row(MEMBER).strava_athlete_id).toBeNull();
    expect(row(MEMBER).strava_auth).toBeNull();
    expect(sessions).toHaveLength(0);
    expect(where(r)).toBe('/?strava=error&reason=verify_email');
    expect(db.tables.athletes).toHaveLength(4);                 // no shell either
  });
  it('an admin\'s name is no key to the admin account', async () => {
    const r = await login({ id: 901, firstname: 'Noa', lastname: 'Admin' });
    expect(row(ADMIN).strava_athlete_id).toBeNull();
    expect(sessions).toHaveLength(0);
    expect(where(r)).toBe('/?strava=error&reason=verify_email');
  });
  it('an approved member who has not come in yet (invited) is sent to the email check too', async () => {
    const r = await login({ id: 902, firstname: 'Tal', lastname: 'Invited' });
    expect(row(INVITED).strava_athlete_id).toBeNull();
    expect(row(INVITED).status).toBe('invited');
    expect(sessions).toHaveLength(0);
    expect(where(r)).toBe('/?strava=error&reason=verify_email');
  });
  it('a pending shell for this Strava id is not "reclaimed" into a member by name on a later login', async () => {
    db.tables.athletes.push({ ...base, id: 'shell', name: 'Dana Levi', email: 'strava_903@strava.madregot.local', role: 'runner',
      status: 'invited', approved: false, strava_athlete_id: 903, strava_enabled: true, garmin_auth: null });
    await login({ id: 903, firstname: 'Dana', lastname: 'Levi' });
    expect(merges).toEqual([]);
    expect(row(MEMBER).strava_athlete_id).toBeNull();
    expect(row('shell').approved).toBe(false);
  });
});

describe('Strava login — journey 3: somebody new', () => {
  it('gets a pending membership (not approved) and a session for the waiting screen, as today', async () => {
    const r = await login({ id: 904, firstname: 'Brand', lastname: 'New' });
    const created = db.tables.athletes.find((a) => a.strava_athlete_id === 904)!;
    expect(created).toMatchObject({ approved: false, status: 'invited', role: 'runner' });
    // What the app makes of that row (/api/auth/me → membership): the waiting screen, not the club.
    const { membershipFor } = await import('@/lib/auth/membership');
    expect(membershipFor(created)).toBe('pending');
    expect(sessions).toHaveLength(1);
    expect(where(r)).toMatch(/^\/auth\/resolve/);
  });
});

describe('what the landing page says', () => {
  it('verify_email has its own words, with no debug code, and does not say the name is a member', async () => {
    const { loginErrorText } = await import('@/lib/auth/login-error');
    const t = loginErrorText('verify_email', 'abc123');
    expect(t.debug).toBeNull();
    expect(t.text).toContain('קוד למייל הרשום');
    expect(t.text).not.toContain('מצאנו');
  });
});
