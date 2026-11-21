import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/notifications/inbox: the week's club posts are read alongside the
 * athlete and notification reads, not as a third round trip after them (native
 * launch latency). The answer itself is unchanged: same group filter, same
 * fail-open, and nothing is read before the auth gate.
 */

const h = vi.hoisted(() => ({
  started: [] as string[],
  releaseAthlete: null as null | (() => void),
  caller: { athleteId: 'a1', isStaff: false, isSuperUser: false } as Record<string, unknown> | null,
  postsFail: false,
  posts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () =>
    h.caller ? { denied: null, caller: h.caller } : { denied: new Response('no', { status: 401 }), caller: null },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: any = {};
      for (const m of ['select', 'eq', 'or', 'not', 'is', 'gte', 'order', 'limit', 'in', 'returns']) q[m] = () => q;
      const result = (): Promise<unknown> => {
        h.started.push(table);
        if (table === 'athletes') {
          return new Promise((res) => {
            h.releaseAthlete = () => res({ data: { group_id: 'g1', role: 'runner', is_academy: false, last_seen_at: null, notification_prefs: null }, error: null });
          });
        }
        if (table === 'feed_items') {
          return Promise.resolve(h.postsFail ? { data: null, error: { message: 'down' } } : { data: h.posts, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      };
      q.maybeSingle = () => result();
      q.then = (ok: any, ko: any) => result().then(ok, ko);
      return q;
    },
  }),
}));

const { GET } = await import('@/app/api/notifications/inbox/route');
const ID = '11111111-1111-4111-8111-111111111111';
const req = () => new Request(`http://x/api/notifications/inbox?athleteId=${ID}`);
const recent = new Date().toISOString();

beforeEach(() => {
  h.started = []; h.releaseAthlete = null; h.postsFail = false;
  h.caller = { athleteId: ID, isStaff: false, isSuperUser: false };
  h.posts = [
    { id: 'p-all', body: 'Club news\nfor everyone', occurred_at: recent, group_id: null },
    { id: 'p-mine', body: 'Group 1 note', occurred_at: recent, group_id: 'g1' },
    { id: 'p-other', body: 'Group 2 note', occurred_at: recent, group_id: 'g2' },
  ];
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('inbox club posts read in parallel', () => {
  it('starts the club-posts query before the athlete read has answered', async () => {
    const pending = GET(req());
    await settle();
    expect(h.started).toContain('athletes');
    expect(h.started).toContain('feed_items'); // already in flight while athletes is held open
    h.releaseAthlete!();
    const res = await pending;
    expect(res.status).toBe(200);
  });

  it('same answer: the caller’s own group and club-wide posts only', async () => {
    const pending = GET(req());
    await settle(); h.releaseAthlete!();
    const body = await (await pending).json();
    const posts = body.items.filter((i: any) => i.kind === 'club_post').map((i: any) => i.id).sort();
    expect(posts).toEqual(['post:p-all', 'post:p-mine']);
  });

  it('fail open: posts down still returns the inbox', async () => {
    h.postsFail = true;
    const pending = GET(req());
    await settle(); h.releaseAthlete!();
    const res = await pending;
    expect(res.status).toBe(200);
    expect((await res.json()).items.filter((i: any) => i.kind === 'club_post')).toEqual([]);
  });

  it('nothing is read before the auth gate: unauthenticated and not-self are refused with no query', async () => {
    h.caller = null;
    expect((await GET(req())).status).toBe(401);
    h.caller = { athleteId: '22222222-2222-4222-8222-222222222222', isStaff: false, isSuperUser: false };
    expect((await GET(req())).status).toBe(403);
    expect(h.started).toEqual([]);
  });
});
