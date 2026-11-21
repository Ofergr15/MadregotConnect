import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Club update topics: ?topic= / ?event= filtering on GET /api/club-updates (real
 * listUpdates over an in-memory db, so the pinned merge is exercised too), the
 * /topics route, and POST topicId.
 */

const caller = vi.fn();
vi.mock('@/lib/club-updates/access', () => ({
  clubUpdatesCaller: () => caller(),
  forbidden: () => new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 }),
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }));

type Row = Record<string, unknown>;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const EV = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EV_NONE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

let tables: Record<string, Row[]>;
let missing: Set<string>;
const inserted: Row[] = [];

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let lim = Infinity;
  const run = async () => {
    if (missing.has(table)) return { data: null, error: { code: '42P01', message: 'missing' } };
    return { data: (tables[table] || []).filter((r) => filters.every((f) => f(r))).slice(0, lim), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return b; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return b; },
    order: () => b,
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: async () => { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    insert: (row: Row) => {
      inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { id: 'new', created_at: 'now', edited_at: null, image_url: null, topic_id: null, ...row }, error: null }) }) };
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  };
  return b;
}
const db = { from: (t: string) => query(t) };

const { GET, POST } = await import('@/app/api/club-updates/route');
const { GET: TOPICS } = await import('@/app/api/club-updates/topics/route');

const as = (canRead = true, canWrite = false) =>
  caller.mockResolvedValue({ denied: null, db, athleteId: 'me', access: { admin: false, canRead, canWrite }, cfg: { enabled: true, writerIds: [] } });
const get = async (qs: string) => {
  const res = await GET(new Request(`http://x/api/club-updates${qs}`));
  return { status: res.status, body: await res.json() };
};
const post = (b: unknown) => POST(new Request('http://x/api/club-updates', { method: 'POST', body: JSON.stringify(b) }));
const u = (id: string, topic_id: string | null, pinned = false): Row => ({
  id, topic_id, pinned, author_athlete_id: 'a', body: id, image_url: null, breaking: false,
  notify_at: null, notified_at: null, edited_at: null, deleted_at: null, created_at: '2026-11-01T00:00:00Z',
});

beforeEach(() => {
  caller.mockReset();
  inserted.length = 0;
  missing = new Set();
  tables = {
    club_update_topics: [
      { id: T1, name: 'ולנסיה', event_id: EV, pinned_text: 'נפגשים בלובי', opens_at: '2026-11-01T00:00:00Z', closes_at: null },
      { id: T2, name: 'אחר', event_id: null, pinned_text: null, opens_at: '2026-11-02T00:00:00Z', closes_at: null },
    ],
    club_updates: [u('g1', null), u('v1', T1), u('o1', T2), u('gpin', null, true), u('vpin', T1, true)],
    athletes: [], club_update_reactions: [],
  };
});

const ids = (b: { updates: Array<{ id: string }> }) => b.updates.map((x) => x.id).sort();

describe('GET /api/club-updates filters', () => {
  it('unfiltered: every update, no topic key', async () => {
    as();
    const { body } = await get('');
    expect(ids(body)).toEqual(['g1', 'gpin', 'o1', 'v1', 'vpin']);
    expect('topic' in body).toBe(false);
  });
  it('?topic= keeps only that topic, pinned merge included', async () => {
    as();
    const { body } = await get(`?topic=${T1}`);
    expect(ids(body)).toEqual(['v1', 'vpin']);
    expect(body.topic).toEqual({ id: T1, eventId: EV, name: 'ולנסיה', pinnedText: 'נפגשים בלובי', opensAt: '2026-11-01T00:00:00Z', closesAt: null });
  });
  it('?event= resolves to that event\'s topics', async () => {
    as();
    const { body } = await get(`?event=${EV}`);
    expect(ids(body)).toEqual(['v1', 'vpin']);
    expect(body.topic.id).toBe(T1);
  });
  it('unknown event → topic null, no updates', async () => {
    as();
    const { body } = await get(`?event=${EV_NONE}`);
    expect(body.topic).toBeNull();
    expect(body.updates).toEqual([]);
  });
  it('malformed ids → 400', async () => {
    as();
    expect((await get('?topic=nope')).status).toBe(400);
    expect((await get('?event=1;drop')).status).toBe(400);
  });
  it('missing topics table → empty and missing, not 500', async () => {
    as();
    missing.add('club_update_topics');
    const { status, body } = await get(`?event=${EV}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ missing: true, updates: [], topic: null });
  });
});

describe('GET /api/club-updates/topics', () => {
  const topics = async (qs = '') => {
    const res = await TOPICS(new Request(`http://x/api/club-updates/topics${qs}`));
    return { status: res.status, body: await res.json() };
  };
  it('a member who cannot read gets nothing', async () => {
    as(false);
    expect((await topics(`?event=${EV}`)).body).toEqual({ enabled: false, topics: [] });
  });
  it('lists an event\'s topics', async () => {
    as();
    const { body } = await topics(`?event=${EV}`);
    expect(body.topics.map((t: { id: string }) => t.id)).toEqual([T1]);
  });
  it('malformed event → 400', async () => {
    as();
    expect((await topics('?event=x')).status).toBe(400);
  });
  it('missing table → graceful', async () => {
    as();
    missing.add('club_update_topics');
    expect((await topics()).body).toEqual({ enabled: true, missing: true, topics: [] });
  });
});

describe('POST /api/club-updates topicId', () => {
  it('stores a known topic', async () => {
    as(true, true);
    const res = await post({ body: 'שלום', topicId: T1 });
    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ topic_id: T1 });
  });
  it('unknown topic → 400 unknown topic', async () => {
    as(true, true);
    const res = await post({ body: 'שלום', topicId: EV_NONE });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown topic' });
    expect(inserted).toHaveLength(0);
  });
  it('malformed topicId → 400', async () => {
    as(true, true);
    expect((await post({ body: 'שלום', topicId: 'abc' })).status).toBe(400);
    expect((await post({ body: 'שלום', topicId: 5 })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });
  it('no topicId → no topic_id written; non-writer still 403', async () => {
    as(true, true);
    await post({ body: 'שלום' });
    expect('topic_id' in inserted[0]).toBe(false);
    as(true, false);
    expect((await post({ body: 'x', topicId: T1 })).status).toBe(403);
  });
});
