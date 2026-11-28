// Route-level contract for POST /api/feed/like, for a native client. FIXTURE only;
// the author notification is stubbed and counted, nothing is sent.
// like_count is maintained by a DB trigger in production; this in-memory DB has none,
// so the test pins `liked`, the rows, and the notification — not the count.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

const db = createMemoryDb({
  schema: {
    feed_items: ['id', 'like_count', 'author_athlete_id', 'type', 'payload', 'deleted_at'],
    feed_likes: ['id', 'feed_item_id', 'athlete_id', 'created_at'],
  },
  unique: { feed_likes: [['feed_item_id', 'athlete_id']] },
  defaults: { feed_likes: () => ({ id: `l${Math.random()}`, created_at: new Date().toISOString() }) },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let session: any = null;
vi.mock('@/lib/auth-session', async (orig) => ({ ...(await orig<typeof import('@/lib/auth-session')>()), requireAthlete: async () => session }));
const notified: unknown[] = [];
vi.mock('@/lib/feed/notify', () => ({
  loadFeedItemMeta: async (id: string) => (id === 'post' ? { authorAthleteId: 'author', type: 'activity' } : null),
  notifyFeedInteraction: async (x: unknown) => { notified.push(x); },
}));

const me = { ok: true, user: { athleteId: 'me', name: 'Me', email: 'x@example.test' } };
const like = async (body: unknown, raw?: string) => {
  const { POST } = await import('@/app/api/feed/like/route');
  const res = await POST(new Request('http://x/api/feed/like', { method: 'POST', body: raw ?? JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const mine = () => db.tables.feed_likes.filter((l) => l.feed_item_id === 'post' && l.athlete_id === 'me').length;

beforeEach(() => {
  db.tables.feed_items.length = 0; db.tables.feed_likes.length = 0; notified.length = 0;
  db.tables.feed_items.push({ id: 'post', like_count: 0, author_athlete_id: 'author', type: 'activity', payload: {}, deleted_at: null });
  session = me;
});

describe('POST /api/feed/like contract', () => {
  it('401 when requireAthlete refuses', async () => {
    session = { ok: false, status: 401, error: 'unauthorized' };
    expect((await like({ itemId: 'post' })).status).toBe(401);
    expect(mine()).toBe(0);
  });
  it('400 without a string itemId', async () => {
    expect((await like({})).status).toBe(400);
    expect((await like({ itemId: 7 })).status).toBe(400);
  });
  it('404 for a missing or deleted item', async () => {
    expect((await like({ itemId: 'nope' }))).toEqual({ status: 404, body: { error: 'Feed item not found' } });
  });
  it('first call likes and notifies the author once', async () => {
    const r = await like({ itemId: 'post' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ liked: true });
    expect(Array.isArray(r.body.likePreview)).toBe(true);
    expect(mine()).toBe(1);
    expect(notified).toHaveLength(1);
  });
  it('NATIVE HAZARD: it is a TOGGLE, so replaying the same request unlikes', async () => {
    await like({ itemId: 'post' });
    const replay = await like({ itemId: 'post' });
    expect(replay.body.liked).toBe(false);
    expect(mine()).toBe(0);
    expect(notified).toHaveLength(1); // the unlike does not notify
  });
  it('a concurrent duplicate insert (23505) ends liked:true and does not notify twice', async () => {
    db.tables.feed_likes.push({ id: 'race', feed_item_id: 'post', athlete_id: 'me', created_at: '' });
    const sel = db.client.from;
    let firstSelect = true;
    db.client.from = (t: string) => {
      const b = sel(t);
      if (t === 'feed_likes' && firstSelect) { firstSelect = false; b.maybeSingle = () => Promise.resolve({ data: null, error: null }); }
      return b;
    };
    try {
      const r = await like({ itemId: 'post' });
      expect(r.body.liked).toBe(true);
      expect(mine()).toBe(1);
      expect(notified).toHaveLength(0);
    } finally { db.client.from = sel; }
  });
  it('malformed JSON is 400 (task 107 body validation)', async () => {
    expect((await like(null, '{')).status).toBe(400);
  });
});
