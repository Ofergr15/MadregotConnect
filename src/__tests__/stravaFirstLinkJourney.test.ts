// The whole first-link journey for an existing member, through the REAL handlers in order:
// Strava sign-in by name → sent to the email check → (signed in by email code: a verified
// session) → "connect Strava" in their profile (GET /api/strava?athleteId) → Strava →
// callback (link mode, signed single-use state) → back on their profile → next Strava sign-in
// is them. Plus retry, a teammate trying to start it, and the coach as the fallback.
// Based on the login-identity fixture: FIXTURE only: the
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
const who = vi.hoisted(() => ({ caller: null as null | Record<string, unknown> }));
// The session is the only stub: who is signed in. The self-or-staff decision is the real one.
vi.mock('@/lib/auth/self-or-staff', async (o) => {
  const real = await o<typeof import('@/lib/auth/self-or-staff')>();
  return {
    ...real,
    requireCallerForAthlete: vi.fn(async (_r: Request, target: string) => {
      if (!who.caller) return { denied: new Response(null, { status: 401 }), caller: { athleteId: null } };
      if (!real.mayActFor(who.caller as never, target)) return { denied: new Response(null, { status: 403 }), caller: who.caller };
      return { denied: null, caller: who.caller };
    }),
  };
});
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
const OTHER_ID = '00000000-0000-4000-8000-0000000000b9';
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


const asMember = () => { who.caller = { athleteId: MEMBER, isStaff: false, isSuperUser: false, email: 'dana.levi@example.test' }; };
const asTeammate = () => { who.caller = { athleteId: LINKED, isStaff: false, isSuperUser: false }; };
const asCoach = () => { who.caller = { athleteId: 'coach-row', isStaff: true, isSuperUser: false, role: 'coach' }; };
async function startLink(athleteId: string) {
  const { GET } = await import('@/app/api/strava/route');
  const res = await GET(new Request(`https://www.madregot.app/api/strava?athleteId=${athleteId}`, { headers: { authorization: 'Bearer t' } }));
  const body = await res.clone().json().catch(() => null);
  const state = body?.authUrl ? new URL(body.authUrl).searchParams.get('state') : null;
  return { status: res.status, state };
}
async function back(state: string | null, stravaAthlete = { id: 900, firstname: 'Dana', lastname: 'Levi' }) {
  athlete = stravaAthlete;
  const { GET } = await import('@/app/api/strava/callback/route');
  const u = new URL('https://www.madregot.app/api/strava/callback');
  u.searchParams.set('code', 'c'); if (state) u.searchParams.set('state', state);
  return GET(new Request(u));
}
beforeEach(() => { who.caller = null; db.tables.app_settings.length = 0; });

describe('existing member, first Strava link — end to end', () => {
  it('name sign-in → email check → connect in profile → back on profile → next Strava sign-in is them', async () => {
    // 1. Strava sign-in by name: nothing written, sent to the email check.
    expect(where(await login({ id: 900, firstname: 'Dana', lastname: 'Levi' }))).toBe('/?strava=error&reason=verify_email');
    expect(row(MEMBER).strava_athlete_id).toBeNull();
    // 2. Signed in by the email code (a verified session as Dana), she presses "connect".
    asMember();
    const start = await startLink(MEMBER);
    expect(start.status).toBe(200);
    expect(start.state).toMatch(/^link\./);
    // 3. Strava sends her back: linked to HER row, returned to HER profile.
    const r = await back(start.state);
    expect(where(r)).toBe('/dashboard/profile?tab=datasource&strava=connected');
    expect(row(MEMBER).strava_athlete_id).toBe(900);
    // 4. Next "Sign in with Strava" is simply Dana (journey 1).
    sessions.length = 0;
    expect(where(await login({ id: 900, firstname: 'Dana', lastname: 'Levi' }))).toMatch(/^\/auth\/resolve/);
    expect(sessions).toHaveLength(1);
    expect(db.tables.athletes).toHaveLength(4);
  });
  it('retry: a second "connect" replaces the first; the abandoned first state no longer links', async () => {
    asMember();
    const first = await startLink(MEMBER);
    const second = await startLink(MEMBER);
    expect(where(await back(first.state))).toBe('/dashboard/profile?tab=datasource&strava=error&reason=bad_state');
    expect(row(MEMBER).strava_athlete_id).toBeNull();
    expect(where(await back(second.state))).toBe('/dashboard/profile?tab=datasource&strava=connected');
    expect(row(MEMBER).strava_athlete_id).toBe(900);
  });
  it('a teammate cannot start a link for Dana', async () => {
    asTeammate();
    const s = await startLink(MEMBER);
    expect(s.status).toBe(403);
    expect(s.state).toBeNull();
  });
  it('no session (email not verified yet): the connect start is refused', async () => {
    expect((await startLink(MEMBER)).status).toBe(401);
  });
  it('route level only (session and staff check stubbed; no UI exists for this): a staff caller starting a link for Dana is accepted and returns to the athletes page', async () => {
    asCoach();
    const s = await startLink(MEMBER);
    expect(where(await back(s.state))).toBe('/dashboard/athletes?strava=connected');
    expect(row(MEMBER).strava_athlete_id).toBe(900);
  });
  it('a used state cannot be replayed; the replay goes back to the profile (no trusted origin) and writes nothing new', async () => {
    asMember();
    const s = await startLink(MEMBER);
    await back(s.state);
    const replay = await back(s.state, { id: 950, firstname: 'Eve', lastname: 'X' });
    expect(where(replay)).toBe('/dashboard/profile?tab=datasource&strava=error&reason=bad_state');
    expect(row(MEMBER).strava_athlete_id).toBe(900);
  });
});

describe('link state bookkeeping (app_settings rows: stravalink:<nonce> + stravalinkret:<nonce>)', () => {
  const keys = (p: string) => db.tables.app_settings.filter((r) => String(r.key).startsWith(p)).map((r) => r.key);
  it('abandoned retry: replacing a coach-started attempt removes its return hint too — one of each left', async () => {
    asCoach();
    await startLink(MEMBER); await startLink(MEMBER); await startLink(MEMBER);
    expect(keys('stravalink:')).toHaveLength(1);
    expect(keys('stravalinkret:')).toHaveLength(1);
  });
  it('expired rows under BOTH prefixes are swept by the next reservation', async () => {
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    db.tables.app_settings.push({ key: 'stravalink:oldnonce', value: OTHER_ID, updated_at: old }, { key: 'stravalinkret:oldnonce', value: 'athletes', updated_at: old });
    asMember(); await startLink(MEMBER);
    expect(keys('stravalink:oldnonce')).toHaveLength(0);
    expect(keys('stravalinkret:oldnonce')).toHaveLength(0);
  });
  it('transient Strava failure on a coach link: reservation AND its athletes return are restored; the retry links and returns there', async () => {
    asCoach();
    const s = await startLink(MEMBER);
    fetchSpy.mockImplementationOnce(async () => new Response('upstream down', { status: 502 }));
    const failed = await back(s.state);
    expect(row(MEMBER).strava_athlete_id).toBeNull();
    expect(failed.status).toBeGreaterThanOrEqual(300);
    expect(keys('stravalinkret:')).toHaveLength(1);
    expect(where(await back(s.state))).toBe('/dashboard/athletes?strava=connected');
    expect(row(MEMBER).strava_athlete_id).toBe(900);
    expect(keys('stravalink:')).toHaveLength(0);
  });
  it('two callbacks with the same state at once: exactly one links', async () => {
    asMember();
    const s = await startLink(MEMBER);
    const [a, b] = await Promise.all([back(s.state), back(s.state, { id: 950, firstname: 'Eve', lastname: 'X' })]);
    const outcomes = [where(a), where(b)].sort();
    expect(outcomes.filter((o) => o.endsWith('strava=connected'))).toHaveLength(1);
    expect(outcomes.filter((o) => o.endsWith('reason=bad_state'))).toHaveLength(1);
    expect([900, 950]).toContain(row(MEMBER).strava_athlete_id);
  });
});

describe('store error while consuming the state', () => {
  const keys = (p: string) => db.tables.app_settings.filter((r) => String(r.key).startsWith(p)).map((r) => r.key);
  it('keeps the coach\'s return hint, so the retry of the same state still returns to the athletes page', async () => {
    asCoach();
    const s = await startLink(MEMBER);
    // The one stub here: the consume's DELETE … WHERE key = stravalink:<nonce> fails once.
    const realFrom = db.client.from.bind(db.client);
    let failOnce = true;
    (db.client as any).from = (t: string) => {
      const q = realFrom(t);
      if (t !== 'app_settings' || !failOnce) return q;
      const del = q.delete.bind(q);
      q.delete = () => { const d = del(); const eq = d.eq.bind(d); d.eq = (c: string, v: string) => (c === 'key' && String(v).startsWith('stravalink:') && failOnce
        ? (failOnce = false, { eq: () => ({ select: async () => ({ data: null, error: { message: 'store down' } }) }) }) : eq(c, v)); return d; };
      return q;
    };
    const r = await back(s.state);
    (db.client as any).from = realFrom;
    expect(where(r)).toBe('/dashboard/athletes?strava=error&reason=link_unavailable');
    expect(keys('stravalinkret:')).toHaveLength(1);
    expect(where(await back(s.state))).toBe('/dashboard/athletes?strava=connected');
    expect(keys('stravalinkret:')).toHaveLength(0);
  });
});
