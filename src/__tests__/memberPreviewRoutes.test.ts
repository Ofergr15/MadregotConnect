import { describe, expect, it, vi, beforeEach } from 'vitest';

// `?as=member` on the member-profile routes (connections, favourites, badges,
// activities, feed): the owner gets exactly a teammate's response, and nobody
// can use the param to see more.
const ME = '11111111-1111-1111-1111-111111111111';
const MATE = '22222222-2222-2222-2222-222222222222';
type Caller = { email: string; athleteId: string | null; isStaff: boolean; isSuperUser: boolean; role: string; isCoreRunner: boolean; canApprove: boolean };
let caller: Caller;
const runner = (id: string): Caller => ({ email: 'x@x', athleteId: id, isStaff: false, isSuperUser: false, role: 'runner', isCoreRunner: false, canApprove: false });

let tables: Record<string, { data: unknown; error: unknown }> = {};
let pending = new Set<string>();
let ctxViewers: Array<{ athleteId: string | null; isStaff: boolean }> = [];

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
  requireCallerForAthlete: async (_r: Request, t: string | null) => {
    const ok = caller.isStaff || caller.isSuperUser || (!!t && caller.athleteId === t);
    return { denied: ok ? null : new Response('{"error":"forbidden"}', { status: 403 }), caller };
  },
}));
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: caller }),
  requireAthlete: async () => ({ ok: true, user: caller }),
  authError: () => new Response('', { status: 401 }),
}));
vi.mock('@/lib/athletes/test-accounts', async (orig) => ({
  ...(await orig<typeof import('@/lib/athletes/test-accounts')>()),
  testAccountIds: async () => new Set<string>(),
  hiddenFromCaller: async (_db: unknown, c: { athleteId?: string | null; isStaff?: boolean }, t: string) =>
    !c.isStaff && c.athleteId !== t && pending.has(t),
}));
vi.mock('@/lib/auth/pending-athletes', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/pending-athletes')>()),
  pendingAthleteIds: async () => new Set(pending),
}));
vi.mock('@/lib/supabase/server', () => {
  const mk = (table: string): any => new Proxy({}, {
    get: (_t, k) => (k === 'then'
      ? (r: (v: unknown) => void) => r(tables[table] ?? { data: [], error: null })
      : k === 'maybeSingle'
        ? () => Promise.resolve({ data: (tables[table]?.data as unknown[] | undefined)?.[0] ?? null, error: null })
        : () => mk(table)),
  });
  return { createServerClient: () => ({ from: (t: string) => mk(t) }) };
});
// The plan-verdict gate (lib/feed/plan-verdicts.ts) is self-or-staff: mirrored here so
// the test pins that the ROUTE hands the preview viewer, not the caller, to it.
vi.mock('@/lib/feed/context', () => ({
  loadFeedContext: async (_db: unknown, _rows: unknown[], viewer: { athleteId: string | null; isStaff: boolean }) => {
    ctxViewers.push(viewer);
    const sees = viewer.isStaff || viewer.athleteId === ME;
    return {
      viewerAthleteId: viewer.athleteId,
      viewerIsStaff: viewer.isStaff,
      likedItemIds: new Set(viewer.athleteId === ME ? ['f1'] : []),
      planVerdictsByActivity: new Map(sees ? [['a1', { activityId: 'a1', status: 'graded', score: 90, direction: 'on_target', workoutName: 'W' }]] : []),
    };
  },
}));

const activityRow = {
  id: 'a1', athlete_id: ME, activity_name: 'Run', activity_type: 'running',
  start_time: '2026-11-20T06:00:00.000Z', distance: 10000, duration: 3000, moving_duration: 3000,
  average_pace: 300, average_hr: 150, max_hr: 175, calories: 600, elevation_gain: 10,
  route_preview: null, has_polyline: false, splits: [{ averagePace: 300 }],
};
const feedRow = (hiddenFields: string[]) => ({
  id: 'f1', type: 'activity', author_athlete_id: ME, body: null, media: [], payload: { hiddenFields },
  occurred_at: '2026-11-20T07:00:00.000Z', like_count: 0, comment_count: 0,
  athletes: { id: ME, name: 'Me', avatar_url: null, groups: null }, athlete_activities: activityRow,
});

const feed = (await import('@/app/api/feed/route')).GET;
const connections = (await import('@/app/api/athletes/[id]/connections/route')).GET;
const badges = (await import('@/app/api/athletes/badges/route')).GET;
const favorites = (await import('@/app/api/athletes/favorites/route')).GET;
const activities = (await import('@/app/api/activities/route')).GET;

const get = (path: string) => new Request(`https://x.test${path}`);
const callFeed = (qs: string) => feed(get(`/api/feed?${qs}`));
const callConn = (id: string, qs = '') => connections(get(`/api/athletes/${id}/connections${qs}`), { params: Promise.resolve({ id }) } as never);

beforeEach(() => {
  caller = runner(ME);
  tables = {};
  pending = new Set();
  ctxViewers = [];
});

describe('feed ?athlete=me&as=member', () => {
  beforeEach(() => { tables.feed_items = { data: [feedRow(['pace', 'heart_rate', 'calories'])], error: null }; });

  it('the owner normally gets the verdict ring; the preview drops it, as a teammate gets it', async () => {
    tables.feed_items = { data: [feedRow([])], error: null };
    const own = await (await callFeed(`athlete=${ME}`)).json();
    expect(own.items[0].activity.planVerdict).toMatchObject({ score: 90 });
    expect(own.items[0].likedByMe).toBe(true);
    const prev = await (await callFeed(`athlete=${ME}&as=member`)).json();
    expect(prev.items[0].activity.planVerdict).toBeNull();
    expect(prev.items[0].likedByMe).toBe(false);
    expect(ctxViewers.at(-1)).toEqual({ athleteId: null, isStaff: false });
    caller = runner(MATE);
    const mate = await (await callFeed(`athlete=${ME}`)).json();
    expect(mate.items[0].activity.planVerdict).toBeNull();
  });

  it('hides the hidden pace / HR / calories', async () => {
    const prev = await (await callFeed(`athlete=${ME}&as=member`)).json();
    expect(prev.items[0].activity).toMatchObject({ averagePace: null, averageHr: null, maxHr: null, calories: null, paceBands: null });
  });

  it('a pending owner previews what teammates see: nothing', async () => {
    pending = new Set([ME]);
    expect((await (await callFeed(`athlete=${ME}`)).json()).items).toHaveLength(1);
    expect((await (await callFeed(`athlete=${ME}&as=member`)).json()).items).toHaveLength(0);
  });

  it('400 for someone else\'s feed, no athlete, or an unknown value; staff in preview lose staff', async () => {
    expect((await callFeed(`athlete=${MATE}&as=member`)).status).toBe(400);
    expect((await callFeed('as=member')).status).toBe(400);
    expect((await callFeed(`athlete=${ME}&as=staff`)).status).toBe(400);
    caller = { ...runner('coach'), isStaff: true };
    await callFeed(`athlete=${ME}&as=member`);
    expect(ctxViewers.at(-1)).toEqual({ athleteId: null, isStaff: false });
  });
});

describe('connections ?as=member', () => {
  beforeEach(() => {
    tables.athletes = { data: [{ id: MATE, name: 'Mate', avatar_url: null, approved: true }], error: null };
    tables.athlete_follows = { data: [{ follower_id: MATE, followee_id: MATE }], error: null };
  });

  it('owner preview: no viewer follow state, same lists', async () => {
    caller = runner(MATE);
    const own = await (await callConn(MATE)).json();
    expect(own.isFollowing).toBe(true);
    const prev = await (await callConn(MATE, '?as=member')).json();
    expect(prev.isFollowing).toBe(false);
    expect(prev.followerCount).toBe(own.followerCount);
  });

  it('a pending owner gets the teammate 404', async () => {
    tables.athletes = { data: [{ id: ME, name: 'Me', avatar_url: null, approved: false }], error: null };
    expect((await callConn(ME)).status).toBe(200);
    expect((await callConn(ME, '?as=member')).status).toBe(404);
  });

  it('can\'t be aimed at someone else', async () => {
    expect((await callConn(MATE, '?as=member')).status).toBe(400);
  });
});

describe('badges ?as=member', () => {
  const call = (id: string, qs = '') => badges(get(`/api/athletes/badges?athleteId=${id}${qs}`));
  it('a pending owner gets the teammate 404; self otherwise unchanged; someone else is 400', async () => {
    expect((await call(ME, '&as=member')).status).toBe(200);
    pending = new Set([ME]);
    expect((await call(ME)).status).toBe(200);
    expect((await call(ME, '&as=member')).status).toBe(404);
    expect((await call(MATE, '&as=member')).status).toBe(400);
  });
});

describe('favorites ?as=member', () => {
  it('a teammate has no read path to your list: empty in preview, and as= can\'t widen', async () => {
    tables.athlete_favorites = { data: [{ favorite_athlete_id: MATE }], error: null };
    expect((await (await favorites(get('/api/athletes/favorites'))).json()).athleteIds).toEqual([MATE]);
    expect((await (await favorites(get('/api/athletes/favorites?as=member'))).json()).athleteIds).toEqual([]);
    expect((await favorites(get('/api/athletes/favorites?as=admin'))).status).toBe(400);
  });
});

describe('activities ?as=member', () => {
  const call = (qs: string) => activities(get(`/api/activities?${qs}`));
  it('self-or-staff list: the preview gets the teammate 403, and a runner can\'t aim it elsewhere', async () => {
    tables.athlete_activities = { data: [activityRow], error: null };
    expect((await call(`athleteId=${ME}`)).status).toBe(200);
    expect((await call(`athleteId=${ME}&as=member`)).status).toBe(403);
    expect((await call(`athleteId=${MATE}&as=member`)).status).toBe(403); // the gate runs first, as today
    caller = { ...runner('coach'), isStaff: true };
    expect((await call('as=member')).status).toBe(400);
    expect((await call(`athleteId=${ME}&as=member`)).status).toBe(403);
  });
});
