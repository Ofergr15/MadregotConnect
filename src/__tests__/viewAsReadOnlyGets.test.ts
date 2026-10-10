import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

// The GET routes that write as a side effect — a last-seen stamp, a read mark, a
// cache fill, a token refresh, a race recompute — skip the write while an admin
// views the app as somebody (lib/auth/view-as.ts). Behavioural for the routes a
// fake database can drive, and a source guard for every one of them, so a route
// that loses its `viewingAsBy` check fails here rather than in somebody's thread.

const ME = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/maintenance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/maintenance')>()),
  readMaintenance: async () => ({ on: false, allow: [] }),
}));

let viewing = true;
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({
    ok: true,
    user: {
      email: 'runner@x.com', athleteEmail: null, athleteId: ME, name: 'Runner', role: 'runner', roles: ['runner'],
      groupId: null, athleteStatus: 'active', membership: 'active', isStaff: false, isSuperUser: false,
      canApprove: false, isCoreRunner: false, ...(viewing ? { viewingAsBy: 'admin@x.com' } : {}),
    },
  }),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void fn(); },
}));

// Every write the routes make, by table.
let writes: Array<{ table: string; op: string }> = [];
const singles: Record<string, unknown> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const write = (op: string) => () => { writes.push({ table, op }); return chain; };
      const chain: Record<string, unknown> = {
        update: write('update'), insert: write('insert'), upsert: write('upsert'), delete: write('delete'),
        select: () => chain, eq: () => chain, in: () => chain, is: () => chain, or: () => chain,
        order: () => chain, limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: singles[table] ?? null, error: null }),
        single: () => Promise.resolve({ data: singles[table] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const recompute = vi.fn(async () => ({ matched: 1 }));
vi.mock('@/lib/races/match-athlete-races', () => ({ recomputeRaceMatches: (...a: unknown[]) => recompute(...(a as [])) }));
vi.mock('@/lib/badges/award-engine', () => ({ checkAndAwardBadges: vi.fn() }));
const refresh = vi.fn(async () => 'token');
vi.mock('@/lib/strava/enrich', () => ({
  getValidStravaToken: (...a: unknown[]) => refresh(...(a as [])),
  enrichActivityRowFromStrava: vi.fn(),
}));
const verdict = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/plan-execution/resolve', () => ({
  resolveExecutionVerdict: (...a: unknown[]) => verdict(...(a as [])),
  resolveExecutionSummaries: vi.fn(),
}));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ tolerances: {} }) }));
const clubRecords = vi.fn(async () => ({ snapshot: {}, recomputed: false }));
vi.mock('@/lib/prs/club-records-store', () => ({ getClubRecords: (...a: unknown[]) => clubRecords(...(a as [])) }));

const { GET: me } = await import('@/app/api/auth/me/route');
const { GET: thread } = await import('@/app/api/workout-feedback/[id]/messages/route');
const { GET: races } = await import('@/app/api/athletes/races/route');
const { GET: accountCheck } = await import('@/app/api/strava/account-check/route');
const { GET: planExecution } = await import('@/app/api/plan-execution/route');
const { GET: records } = await import('@/app/api/club/records/route');

const get = (path: string) => new Request(`https://madregot.app${path}`);

beforeEach(() => {
  writes = [];
  viewing = true;
  for (const k of Object.keys(singles)) delete singles[k];
  recompute.mockClear(); refresh.mockClear(); verdict.mockClear(); clubRecords.mockClear();
});

describe('side-effect GETs while viewing as somebody', () => {
  it('/api/auth/me answers without stamping last_seen_at (and does stamp it for real)', async () => {
    singles.athletes = { is_academy: false, approved: true, first_seen_at: null };
    expect((await me(get('/api/auth/me'))).status).toBe(200);
    expect(writes).toEqual([]);
    viewing = false;
    await me(get('/api/auth/me'));
    expect(writes.some((w) => w.table === 'athletes' && w.op === 'update')).toBe(true);
  });

  it('a workout-feedback thread is read without marking it read', async () => {
    singles.workout_feedback = { id: 'f1', athlete_id: ME };
    singles.athletes = { id: ME, role: 'runner' };
    const params = { params: Promise.resolve({ id: 'f1' }) };
    expect((await thread(get('/api/workout-feedback/f1/messages'), params)).status).toBe(200);
    expect(writes).toEqual([]);
    viewing = false;
    await thread(get('/api/workout-feedback/f1/messages'), params);
    expect(writes).toEqual([{ table: 'workout_feedback', op: 'update' }]);
  });

  it('races are read as stored, with no recompute (no matches, no badge, no push)', async () => {
    await races(get(`/api/athletes/races?athleteId=${ME}`));
    expect(recompute).not.toHaveBeenCalled();
    viewing = false;
    await races(get(`/api/athletes/races?athleteId=${ME}`));
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('the Strava account check never refreshes the viewed person\'s token', async () => {
    singles.athletes = { id: ME, name: 'Runner', strava_athlete_id: 1, strava_auth: 'enc' };
    const body = await (await accountCheck(get(`/api/strava/account-check?athleteId=${ME}`))).json();
    expect(body).toMatchObject({ checkable: false, reason: 'view_as' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a plan-execution verdict is resolved read-only', async () => {
    singles.athlete_activities = { athlete_id: ME };
    await planExecution(get('/api/plan-execution?activityId=a1'));
    expect(verdict).toHaveBeenCalledWith(expect.anything(), 'a1', expect.anything(), { readOnly: true });
    viewing = false;
    await planExecution(get('/api/plan-execution?activityId=a1'));
    expect(verdict).toHaveBeenLastCalledWith(expect.anything(), 'a1', expect.anything(), { readOnly: false });
  });

  it('club records never rewrite the stored snapshot', async () => {
    await records(get('/api/club/records'));
    expect(clubRecords).toHaveBeenCalledWith(expect.anything(), { refresh: false, readOnly: true });
  });

  // The rest need Garmin, Stream or GitHub to drive, so they are held by source.
  it.each([
    'app/api/auth/me/route.ts',
    'app/api/workout-feedback/[id]/messages/route.ts',
    'app/api/workout-feedback/route.ts',
    'app/api/academy/segments/route.ts',
    'app/api/garmin/activity-details/route.ts',
    'app/api/athletes/races/route.ts',
    'app/api/plan-execution/route.ts',
    'app/api/club/records/route.ts',
    'app/api/run-chat/laps/route.ts',
    'app/api/strava/account-check/route.ts',
    'app/api/whats-new/route.ts',
  ])('%s checks viewingAsBy before its side-effect write', (route) => {
    const source = readFileSync(new URL(`../${route}`, import.meta.url), 'utf8');
    expect(source).toMatch(/viewingAsBy/);
  });
});
