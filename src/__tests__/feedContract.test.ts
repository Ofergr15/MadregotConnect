import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native feed: GET /api/feed (+ its keyset cursor) and POST /api/feed/like.
 * The real route handlers, the real projection (`projectFeedItem`, `maskHiddenStats`), the real
 * feed context and pending-author filter run against a fake Supabase client. Faked: the session
 * resolver, the DB, and two side readers that have their own suites (plan verdicts — see
 * feedPlanVerdicts.test.ts — and quality names) plus the like notification push.
 * If one of these breaks, the native decoder breaks with it. See docs/contracts/feed.md.
 */

type Op = [string, ...unknown[]];
type Q = { table: string; ops: Op[]; kind: 'select' | 'insert' | 'delete' | 'update' };
const log: Q[] = [];
let answer: (q: Q) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function builder(table: string) {
  const q: Q = { table, ops: [], kind: 'select' };
  log.push(q);
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'lte', 'order', 'limit', 'insert', 'delete', 'update']) {
    b[m] = (...args: unknown[]) => {
      if (m === 'insert' || m === 'delete' || m === 'update') q.kind = m;
      q.ops.push([m, ...args]);
      return b;
    };
  }
  b.maybeSingle = async () => answer(q);
  b.single = async () => answer(q);
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer(q)).then(res, rej);
  return b;
}
const db = { from: (t: string) => builder(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

type User = { athleteId: string | null; isStaff: boolean; name: string; athleteStatus: string };
let session: { ok: true; user: User } | { ok: false; status: number; error: string } = { ok: false, status: 401, error: 'Missing bearer token' };
vi.mock('@/lib/auth-session', async (orig) => {
  const real = await orig<typeof import('@/lib/auth-session')>();
  return {
    authError: real.authError,
    requireSession: async () => session,
    // Same rule as the real requireAthlete: a session without an active athlete row is 403.
    requireAthlete: async () => {
      if (!session.ok) return session;
      if (!session.user.athleteId) return { ok: false, status: 403, error: 'This account has no athlete profile' };
      if (session.user.athleteStatus !== 'active') return { ok: false, status: 403, error: 'Account is not active' };
      return session;
    },
  };
});
const verdictViewers: unknown[] = [];
let verdicts = new Map<string, unknown>();
vi.mock('@/lib/feed/plan-verdicts', () => ({
  loadFeedPlanVerdicts: async (_db: unknown, _rows: unknown, viewer: unknown) => { verdictViewers.push(viewer); return verdicts; },
}));
vi.mock('@/lib/activities/quality-name', () => ({ qualityNames: async () => new Map() }));
const notified: unknown[] = [];
vi.mock('@/lib/feed/notify', async (orig) => ({
  ...(await orig<typeof import('@/lib/feed/notify')>()),
  notifyFeedInteraction: async (x: unknown) => { notified.push(x); },
}));

const feed = await import('@/app/api/feed/route');
const like = await import('@/app/api/feed/like/route');

const ME = '11111111-1111-4111-8111-111111111111';
const MATE = '22222222-2222-4222-8222-222222222222';
const member = (over: Partial<User> = {}): typeof session => ({ ok: true, user: { athleteId: ME, isStaff: false, name: 'אני', athleteStatus: 'active', ...over } });

const LAPS = [
  { distance: 2000, duration: 600, averageHR: 140 },
  { distance: 1000, duration: 220, averageHR: 170 },
  { distance: 400, duration: 180, averageHR: 150 },
  { distance: 1000, duration: 218, averageHR: 172 },
];
const ACT = {
  id: 'act-1', athlete_id: MATE, garmin_activity_id: 987, activity_name: 'אינטרוולים', activity_type: 'running',
  start_time: '2026-11-19T06:10:00+00:00', distance: 4400, duration: 1218, moving_duration: 1200, average_pace: 277,
  average_hr: 158, max_hr: 181, calories: 320, elevation_gain: 12, location_name: 'תל אביב', perceived_rpe: null,
  perceived_feel: null, route_preview: [{ lat: 32.1, lng: 34.8 }, { lat: 32.11, lng: 34.81 }], route_preview_hd: null,
  has_polyline: true, splits: null, laps: LAPS,
};
const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'fi-run', type: 'activity', author_athlete_id: MATE, body: null, media: [], payload: null,
  occurred_at: '2026-11-19T06:10:00+00:00', like_count: 2, comment_count: 0,
  athletes: { id: MATE, name: 'חבר', avatar_url: null, groups: { name: 'קבוצה 1' } },
  athlete_activities: ACT,
  ...over,
});
const POST = {
  id: 'fi-post', type: 'post', author_athlete_id: ME, body: 'בוקר טוב', media: [{ path: 'p/1.jpg', url: 'https://cdn/p/1.jpg', w: 1080, h: 720 }],
  payload: null, occurred_at: '2026-11-18T20:00:00+00:00', like_count: 0, comment_count: 1,
  athletes: { id: ME, name: 'אני', avatar_url: 'https://cdn/a.jpg', groups: null }, athlete_activities: null,
};
const LIKER = (id: string, name: string, item = 'fi-run') => ({ feed_item_id: item, created_at: '2026-11-19T07:00:00Z', athletes: { id, name, avatar_url: null } });

let feedRows: unknown[] = [];
function feedDb(q: Q) {
  if (q.table === 'feed_items') return { data: feedRows, error: null };
  if (q.table === 'feed_likes') return { data: [LIKER(ME, 'אני'), LIKER(MATE, 'חבר')], error: null };
  if (q.table === 'feed_comments') return { data: [{ id: 'c1', feed_item_id: 'fi-post', athlete_id: MATE, body: 'יפה', created_at: '2026-11-18T21:00:00Z', athletes: { id: MATE, name: 'חבר', avatar_url: null } }], error: null };
  if (q.table === 'athletes') return { data: [], error: null }; // nobody pending
  return { data: null, error: null };
}
const get = (qs = '', headers: Record<string, string> = { authorization: 'Bearer t' }) =>
  feed.GET(new Request(`http://x/api/feed${qs}`, { headers }));

beforeEach(() => {
  log.length = 0; notified.length = 0; verdictViewers.length = 0; verdicts = new Map();
  session = { ok: false, status: 401, error: 'Missing bearer token' };
  feedRows = [];
  answer = feedDb;
});

describe('GET /api/feed — auth', () => {
  it('no session → 401 { error } and no DB read', async () => {
    const res = await get('', {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Missing bearer token' });
    expect(log).toEqual([]);
  });
  it('a session the gate refuses (unapproved / no membership) → that status, { error }', async () => {
    session = { ok: false, status: 403, error: 'pending' };
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'pending' });
  });
});

describe('GET /api/feed — item shape', () => {
  it('→ { items: FeedItem[], nextCursor } — camelCase, activity nested, laps never on the wire', async () => {
    session = member();
    feedRows = [ROW(), POST];
    const res = await get('?limit=30');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
    expect(body.nextCursor).toBeNull();
    const [run, post] = body.items;
    expect(run).toEqual({
      id: 'fi-run', type: 'activity',
      author: { athleteId: MATE, name: 'חבר', avatarUrl: null, groupName: 'קבוצה 1' },
      body: null, media: [], payload: null, occurredAt: '2026-11-19T06:10:00+00:00',
      likeCount: 2, commentCount: 0, likedByMe: true,
      likePreview: [{ athleteId: ME, name: 'אני', avatarUrl: null }, { athleteId: MATE, name: 'חבר', avatarUrl: null }],
      commentPreview: [], canDelete: false, paceHidden: false,
      activity: {
        id: 'act-1', athleteId: MATE, garminActivityId: 987, activityName: 'אינטרוולים', activityType: 'running',
        startTime: '2026-11-19T06:10:00+00:00', distance: 4400, duration: 1218, movingDuration: 1200,
        averagePace: 277, averageHr: 158, maxHr: 181, calories: 320, elevationGain: 12, locationName: 'תל אביב',
        perceivedRpe: null, perceivedFeel: null,
        // A two-point trace sits wholly inside the start/finish privacy zone (route-trim.ts): nothing to draw.
        routePreview: null, routeHd: false, hasRoute: false,
        paceBands: expect.any(Array),
        lapBands: [{ m: 2000, pace: 300, hr: 140 }, { m: 1000, pace: 220, hr: 170 }, { m: 400, pace: 450, hr: 150 }, { m: 1000, pace: 218, hr: 172 }],
        stepBands: null, planVerdict: null, qualityName: null,
      },
    });
    expect(post).toMatchObject({
      id: 'fi-post', type: 'post', canDelete: true, activity: null, likedByMe: false, likePreview: [],
      media: [{ path: 'p/1.jpg', url: 'https://cdn/p/1.jpg', w: 1080, h: 720 }],
      commentPreview: [expect.objectContaining({ id: 'c1', body: 'יפה' })],
    });
    // Raw laps / splits / gps never leave the server.
    const wire = JSON.stringify(body);
    expect(wire).not.toMatch(/"laps"|"splits"|"gps_points"|"gpsPoints"|"hrTrace"/);
  });

  it('`startTime` is passed through as stored: wall-clock shaped as UTC, never shifted', async () => {
    session = member();
    feedRows = [ROW()];
    const { items } = await (await get()).json();
    expect(items[0].activity.startTime).toBe(ACT.start_time);
  });

  it('plan verdicts are graded for the viewer (self-or-staff), and a verdict rides on activity.planVerdict', async () => {
    session = member({ athleteId: MATE });
    verdicts = new Map([['act-1', { score: 92 }]]);
    feedRows = [ROW()];
    const { items } = await (await get()).json();
    expect(verdictViewers).toEqual([{ athleteId: MATE, isStaff: false }]);
    expect(items[0].activity.planVerdict).toEqual({ score: 92 });
  });
});

describe('GET /api/feed — hidden fields', () => {
  it('payload.hiddenFields pace/heart_rate/calories → those stats null for EVERY viewer, the owner included', async () => {
    verdicts = new Map([['act-1', { score: 92 }]]);
    feedRows = [ROW({ payload: { hiddenFields: ['pace', 'heart_rate', 'calories'] } })];
    for (const viewer of [member({ athleteId: MATE }), member(), member({ athleteId: null, isStaff: true })]) {
      session = viewer;
      const { items } = await (await get()).json();
      const a = items[0].activity;
      expect(a).toMatchObject({
        averagePace: null, paceBands: null, lapBands: null, stepBands: null, planVerdict: null,
        averageHr: null, maxHr: null, calories: null,
      });
      // Distance/duration are never hideable.
      expect(a).toMatchObject({ distance: 4400, duration: 1218 });
      // The toggles themselves still ship, so the share sheet can render them.
      expect(items[0].payload).toEqual({ hiddenFields: ['pace', 'heart_rate', 'calories'] });
      expect(JSON.stringify(items)).not.toMatch(/"laps"|"hr":/);
    }
  });
  it('heart_rate alone strips hr from lapBands but keeps the pace bars', async () => {
    session = member();
    feedRows = [ROW({ payload: { hiddenFields: ['heart_rate'] } })];
    const { items } = await (await get()).json();
    expect(items[0].activity.lapBands).toEqual([{ m: 2000, pace: 300 }, { m: 1000, pace: 220 }, { m: 400, pace: 450 }, { m: 1000, pace: 218 }]);
    expect(items[0].activity.averagePace).toBe(277);
  });
});

describe('GET /api/feed — paging', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
    ...POST, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    occurred_at: new Date(Date.UTC(2026, 10, 19) - i * 60_000).toISOString(),
  }));
  it('limit=30 asks for 31 rows; a 31st row → 30 items and nextCursor "<occurred_at>,<id>" of the 30th', async () => {
    session = member();
    feedRows = rows(31);
    const body = await (await get('?limit=30')).json();
    const q = log.find((x) => x.table === 'feed_items')!;
    expect(q.ops).toContainEqual(['limit', 31]);
    expect(body.items).toHaveLength(30);
    const last = feedRows[29] as { occurred_at: string; id: string };
    expect(body.nextCursor).toBe(`${last.occurred_at},${last.id}`);
  });
  it('limit is clamped to [1, 40]; default 20', async () => {
    session = member();
    await get('?limit=500');
    await get();
    const limits = log.filter((x) => x.table === 'feed_items').map((x) => x.ops.find(([m]) => m === 'limit'));
    expect(limits).toEqual([['limit', 41], ['limit', 21]]);
  });
  it('cursor → strictly-after keyset filter; last page → nextCursor null', async () => {
    session = member();
    feedRows = rows(3);
    const c = '2026-11-19T00:00:00.000Z,00000000-0000-4000-8000-000000000009';
    const body = await (await get(`?limit=30&cursor=${encodeURIComponent(c)}`)).json();
    const q = log.find((x) => x.table === 'feed_items')!;
    expect(q.ops).toContainEqual(['or', 'occurred_at.lt.2026-11-19T00:00:00.000Z,and(occurred_at.eq.2026-11-19T00:00:00.000Z,id.lt.00000000-0000-4000-8000-000000000009)']);
    expect(body.nextCursor).toBeNull();
  });
  it('a cursor whose time is not a date → 400 { error: "Invalid cursor" }', async () => {
    session = member();
    const res = await get('?cursor=yesterday,abc');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid cursor' });
  });
  it('a page can come back SHORT (pending authors dropped after the slice) while nextCursor is still set', async () => {
    session = member();
    feedRows = rows(3).map((r) => ({ ...r, author_athlete_id: MATE }));
    answer = (q) => (q.table === 'athletes' ? { data: [{ id: MATE }], error: null } : feedDb(q));
    const body = await (await get('?limit=2')).json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBe(`${(feedRows[1] as { occurred_at: string }).occurred_at},${(feedRows[1] as { id: string }).id}`);
  });
  it('a DB error → 500 { error }', async () => {
    session = member();
    answer = (q) => (q.table === 'feed_items' ? { data: null, error: { message: 'boom' } } : feedDb(q));
    const res = await get();
    expect(res.status).toBe(500);
    expect(Object.keys(await res.json())).toEqual(['error']);
  });
});

describe('POST /api/feed/like', () => {
  const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer t' }) =>
    like.POST(new Request('http://x/api/feed/like', { method: 'POST', headers, body: JSON.stringify(body) }));
  const likeDb = (existing: boolean) => (q: Q) => {
    if (q.table === 'feed_items') {
      return q.ops.some(([m, c]) => m === 'select' && c === 'like_count')
        ? { data: { like_count: existing ? 1 : 3 }, error: null }
        : { data: { author_athlete_id: MATE, type: 'activity', payload: null, deleted_at: null }, error: null };
    }
    if (q.table === 'feed_likes') {
      if (q.kind !== 'select') return { data: null, error: null };
      if (q.ops.some(([m, c]) => m === 'select' && c === 'id')) return { data: existing ? { id: 'like-1' } : null, error: null };
      return { data: [LIKER(ME, 'אני'), LIKER(MATE, 'חבר')], error: null };
    }
    return { data: null, error: null };
  };

  it('no session → 401; session without an active athlete row → 403', async () => {
    expect((await post({ itemId: 'fi-run' }, {})).status).toBe(401);
    session = member({ athleteId: null, isStaff: true });
    const res = await post({ itemId: 'fi-run' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'This account has no athlete profile' });
  });
  it('missing itemId → 400 { error: "itemId required" }; unknown/deleted item → 404', async () => {
    session = member();
    const bad = await post({});
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'itemId required' });
    answer = () => ({ data: null, error: null });
    const missing = await post({ itemId: 'nope' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Feed item not found' });
  });
  it('not yet liked → inserts, { liked: true, likeCount, likePreview } and notifies the author once', async () => {
    session = member();
    answer = likeDb(false);
    const res = await post({ itemId: 'fi-run' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      liked: true, likeCount: 3,
      likePreview: [{ athleteId: ME, name: 'אני', avatarUrl: null }, { athleteId: MATE, name: 'חבר', avatarUrl: null }],
    });
    expect(log.find((q) => q.table === 'feed_likes' && q.kind === 'insert')!.ops).toContainEqual(['insert', { feed_item_id: 'fi-run', athlete_id: ME }]);
    expect(notified).toHaveLength(1);
  });
  it('already liked → deletes (a toggle), { liked: false, ... }, no notification', async () => {
    session = member();
    answer = likeDb(true);
    expect(await (await post({ itemId: 'fi-run' })).json()).toMatchObject({ liked: false, likeCount: 1 });
    expect(log.some((q) => q.table === 'feed_likes' && q.kind === 'delete')).toBe(true);
    expect(notified).toEqual([]);
  });
  it('a double-tap race (23505) is still { liked: true } and does not notify twice', async () => {
    session = member();
    const base = likeDb(false);
    answer = (q) => (q.table === 'feed_likes' && q.kind === 'insert' ? { data: null, error: { code: '23505' } } : base(q));
    expect(await (await post({ itemId: 'fi-run' })).json()).toMatchObject({ liked: true });
    expect(notified).toEqual([]);
  });
});
