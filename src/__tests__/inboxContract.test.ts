import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native inbox (plan V6): GET /api/notifications/inbox, /unread and
 * /approvals. The real route handlers (and the real inbox shaping / aggregation / unread
 * count in lib/notifications + lib/push) run against a fake Supabase client; only auth,
 * the DB and the Stream chat count are faked. If one of these breaks, the native decoder
 * breaks with it — change the app's models in the same change.
 */

type Op = [string, ...unknown[]];
type Q = { table: string; ops: Op[] };
const log: Q[] = [];
let answer: (q: Q) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function builder(table: string) {
  const q: Q = { table, ops: [] };
  log.push(q);
  const b: any = new Proxy({}, {
    get(_t, m: string) {
      if (m === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer(q)).then(res, rej);
      if (m === 'maybeSingle' || m === 'single') return async () => answer(q);
      return (...args: unknown[]) => { q.ops.push([m, ...args]); return b; };
    },
  });
  return b;
}
const db = { from: (t: string) => builder(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

type Caller = { athleteId: string | null; isStaff: boolean; isSuperUser: boolean; canApprove?: boolean; name?: string; email?: string };
let caller: Caller | null = null;
const unauthorized = () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => (caller ? { denied: null, caller } : { denied: unauthorized(), caller: null }),
}));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-session')>()),
  requireSession: async () => (caller
    ? { ok: true, user: { ...caller, name: caller.name ?? 'עופר', email: caller.email ?? 'o@x', canApprove: !!caller.canApprove } }
    : { ok: false, status: 401, error: 'unauthorized' }),
}));
vi.mock('@/lib/stream/unread', () => ({ streamUnreadForAthlete: async () => 2, streamUnreadForAthletes: async () => new Map() }));

const inbox = await import('@/app/api/notifications/inbox/route');
const unread = await import('@/app/api/notifications/unread/route');
const approvals = await import('@/app/api/notifications/approvals/route');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const req = (path: string) => new Request(`http://x${path}`, { headers: { authorization: 'Bearer t' } });
const ATHLETE = { group_id: 'g1', role: 'runner', is_academy: false, last_seen_at: '2026-11-19T10:00:00Z', notification_prefs: null };
const ROW = {
  id: 'n1', kind: 'coach_message', title_he: 'אימון מחר', body_he: '05:30 בפארק', url: '/dashboard/plan',
  last_sent_at: '2026-11-19T12:00:00Z', audience_type: 'all', actor_athlete_id: null, actor: { name: 'עופר', avatar_url: 'https://a/x.png' },
};

beforeEach(() => { log.length = 0; caller = null; answer = () => ({ data: null, error: null }); });

describe('GET /api/notifications/inbox', () => {
  const inboxDb = (rows: unknown[], posts: unknown[] = []) => (q: Q) => {
    if (q.table === 'athletes') return { data: ATHLETE, error: null };
    if (q.table === 'scheduled_notifications') return { data: rows, error: null };
    if (q.table === 'feed_items') return { data: posts, error: null };
    return { data: [], error: null };
  };

  it('no session → 401', async () => {
    expect((await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`))).status).toBe(401);
  });
  it('another athlete → 403 { error: "forbidden" }; staff may read anyone', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    const res = await inbox.GET(req(`/api/notifications/inbox?athleteId=${OTHER}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    caller = { athleteId: ME, isStaff: true, isSuperUser: false };
    answer = inboxDb([]);
    expect((await inbox.GET(req(`/api/notifications/inbox?athleteId=${OTHER}`))).status).toBe(200);
  });
  it('missing / non-UUID athleteId → 200 { items: [], unread: 0 } BEFORE any auth check', async () => {
    for (const q of ['', '?athleteId=me']) {
      const res = await inbox.GET(new Request(`http://x/api/notifications/inbox${q}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: [], unread: 0 });
    }
  });
  it('→ { items: Item[], unread } — camelCase, unread = sent after athletes.last_seen_at', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    answer = inboxDb([ROW, { ...ROW, id: 'n0', audience_type: 'athlete', last_sent_at: '2026-11-18T08:00:00Z', actor: null, url: '#ledger:x' }]);
    const body = await (await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`))).json();
    expect(body).toEqual({
      items: [
        { id: 'n1', kind: 'coach_message', title: 'אימון מחר', body: '05:30 בפארק', url: '/dashboard/plan', sentAt: '2026-11-19T12:00:00Z',
          unread: true, actorName: 'עופר', actorAvatarUrl: 'https://a/x.png', toAll: true },
        // A '#…' url (ledger sentinel) that slipped through the query is dropped by the JS filter.
      ],
      unread: 1,
    });
  });
  it('a read row (sent before last_seen_at) has unread:false; a "#" url falls back to /dashboard', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    answer = inboxDb([{ ...ROW, last_sent_at: '2026-11-18T00:00:00Z', url: null, audience_type: 'athlete', actor: null }]);
    const body = await (await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`))).json();
    expect(body.items[0]).toMatchObject({ unread: false, url: '/dashboard', actorName: null, actorAvatarUrl: null, toAll: false });
    expect(body.unread).toBe(0);
  });
  it('window: newest 150 sent rows, ledger rows excluded in the query, ordered by last_sent_at desc', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    answer = inboxDb([]);
    await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`));
    const q = log.find((x) => x.table === 'scheduled_notifications')!;
    expect(q.ops).toContainEqual(['limit', 150]);
    expect(q.ops).toContainEqual(['eq', 'status', 'sent']);
    expect(q.ops).toContainEqual(['not', 'url', 'like', '#ledger:%']);
    expect(q.ops).toContainEqual(['order', 'last_sent_at', { ascending: false }]);
    expect(q.ops).toContainEqual(['or', `audience_type.eq.all,and(audience_type.eq.group,audience_id.eq.g1),and(audience_type.eq.athlete,audience_id.eq.${ME})`]);
  });
  it('a burst of likes on the same url is folded into ONE row (unread counts rows, not pushes)', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    const like = { ...ROW, kind: 'like', url: '/feed?item=f1', audience_type: 'athlete', actor: { name: 'דנה', avatar_url: null } };
    answer = inboxDb([like, { ...like, id: 'n2' }, { ...like, id: 'n3' }]);
    const body = await (await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`))).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('n1');
    expect(body.unread).toBe(1);
  });
  it('club posts (feed announcements, last 7 days) are merged in as kind "club_post", id "post:<feedItemId>"', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    answer = inboxDb([], [{ id: 'f9', body: 'מזל טוב לדנה!\nרצה מרתון', occurred_at: '2026-11-19T15:00:00Z', group_id: null }]);
    const body = await (await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`))).json();
    expect(body.items).toEqual([{
      id: 'post:f9', kind: 'club_post', title: 'מזל טוב לדנה!', body: 'רצה מרתון', url: '/feed?item=f9',
      sentAt: '2026-11-19T15:00:00Z', unread: true, actorName: null, actorAvatarUrl: null, toAll: true,
    }]);
  });
  it('unknown athlete row → { items: [], unread: 0 }; DB error → 500 with items:[] and unread:0 still present', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    expect(await (await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`))).json()).toEqual({ items: [], unread: 0 });
    answer = (q) => (q.table === 'athletes' ? { data: null, error: { message: 'boom' } } : { data: [], error: null });
    const res = await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom', items: [], unread: 0 });
  });
  it('is read-only: opening the inbox does not mark anything read (no update issued)', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    answer = inboxDb([ROW]);
    await inbox.GET(req(`/api/notifications/inbox?athleteId=${ME}`));
    expect(log.flatMap((q) => q.ops).some(([m]) => m === 'update' || m === 'upsert' || m === 'insert')).toBe(false);
  });
});

describe('GET /api/notifications/unread', () => {
  it('no session → 401 (never a silent { count: 0 })', async () => {
    expect((await unread.GET(req(`/api/notifications/unread?athleteId=${ME}`))).status).toBe(401);
  });
  it('another athlete → 403 { error: "forbidden" }', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    const res = await unread.GET(req(`/api/notifications/unread?athleteId=${OTHER}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });
  it('missing / non-UUID athleteId → 200 { count: 0 }', async () => {
    expect(await (await unread.GET(new Request('http://x/api/notifications/unread'))).json()).toEqual({ count: 0 });
  });
  it('→ { count } = unread notification rows (pushes, not folded) + Stream chat unread', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    answer = (q) => {
      if (q.table === 'athletes') return q.ops.some(([m]) => m === 'in') ? { data: [], error: null } : { data: ATHLETE, error: null };
      if (q.table === 'scheduled_notifications') return {
        data: [
          { kind: 'like', url: '/feed?item=f1', audience_type: 'athlete', audience_id: ME, last_sent_at: '2026-11-19T12:00:00Z' },
          { kind: 'like', url: '/feed?item=f1', audience_type: 'athlete', audience_id: ME, last_sent_at: '2026-11-19T12:01:00Z' },
          { kind: 'x', url: '#ledger:abc', audience_type: 'athlete', audience_id: ME, last_sent_at: '2026-11-19T12:02:00Z' },
        ],
        error: null,
      };
      return { data: [], error: null };
    };
    const res = await unread.GET(req(`/api/notifications/unread?athleteId=${ME}`));
    expect(await res.json()).toEqual({ count: 4 }); // 2 likes (not folded) + 2 chat; ledger row excluded
  });
  it('an internal failure → 200 { count: 0 }', async () => {
    caller = { athleteId: ME, isStaff: false, isSuperUser: false };
    answer = () => { throw new Error('boom'); };
    const res = await unread.GET(req(`/api/notifications/unread?athleteId=${ME}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0 });
  });
});

describe('GET /api/notifications/approvals (approvers only)', () => {
  it('no session → 401; a member who cannot approve → 403 { error: "Forbidden" }', async () => {
    expect((await approvals.GET(req('/api/notifications/approvals'))).status).toBe(401);
    caller = { athleteId: ME, isStaff: true, isSuperUser: false, canApprove: false };
    const res = await approvals.GET(req('/api/notifications/approvals'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });
  it('→ { mode, today, days: ApprovalDay[], groups } — team days in the next 8 days (Israel), Hebrew copy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T08:00:00Z')); // Sunday 10:00 Israel
    try {
      caller = { athleteId: ME, isStaff: true, isSuperUser: false, canApprove: true };
      answer = (q) => {
        if (q.table === 'app_settings') {
          const key = q.ops.find(([m, k]) => m === 'eq' && k === 'key')?.[2];
          if (key === 'notif_approvals') return { data: { value: JSON.stringify({ mode: 'team', days: { '2026-11-24': { status: 'approved', by: 'עופר', at: '2026-11-22T07:00:00Z' } } }) }, error: null };
          return { data: null, error: null };
        }
        if (q.table === 'groups') return { data: [{ id: 'g2', name: 'קבוצה 2' }, { id: 'g1', name: 'קבוצה 1' }], error: null };
        if (q.table === 'athletes') return { data: [{ id: 'a1' }, { id: 'a2' }], error: null };
        return { data: null, error: null };
      };
      const body = await (await approvals.GET(req('/api/notifications/approvals'))).json();
      expect(Object.keys(body).sort()).toEqual(['days', 'groups', 'mode', 'today']);
      expect(body.mode).toBe('team');
      expect(body.today).toBe('2026-11-22');
      expect(body.groups).toEqual([{ id: 'g1', name: 'קבוצה 1' }, { id: 'g2', name: 'קבוצה 2' }]);
      // Default team days are Tue (2) and Fri (5): 11-24, 11-27 within today+0..7.
      expect(body.days.map((d: any) => [d.date, d.dayOfWeek, d.state])).toEqual([
        ['2026-11-24', 2, 'approved'], ['2026-11-27', 5, 'pending'],
      ]);
      const tue = body.days[0];
      expect(Object.keys(tue).sort()).toEqual(['askAt', 'date', 'dayOfWeek', 'decidedAt', 'decidedBy', 'pushes', 'quality', 'state', 'workoutName'].sort());
      expect(tue).toMatchObject({ decidedBy: 'עופר', decidedAt: '2026-11-22T07:00:00Z', quality: false, workoutName: null });
      expect(tue.pushes.map((p: any) => p.key)).toEqual(['dayBefore', 'eveningBefore']);
      expect(Object.keys(tue.pushes[0]).sort()).toEqual(['audience', 'audienceId', 'body', 'defaultBody', 'defaultHour', 'defaultTitle', 'edited', 'hour', 'key', 'off', 'slot', 'title', 'week', 'when'].sort());
      expect(tue.pushes[0]).toMatchObject({ slot: 'dayBefore:2', week: '2026-11-22', hour: 8, defaultHour: 8, audience: 'כל הרצים (2)', audienceId: null, off: false, edited: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
