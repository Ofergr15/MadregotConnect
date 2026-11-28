import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task 157: the run detail's kudos (GET /api/activities/[id]/kudos) says the same as
// the feed card for the same run — a test account's kudos is hidden from other members
// and dropped from the total — and "did I give it" is exact even past the 20-giver cap.

const OWNER = 'owner';
const TESTER = 'tester';

const h = vi.hoisted(() => ({
  likes: [] as Array<{ feed_item_id: string; athlete_id: string; created_at: string; athletes: { id: string; name: string; avatar_url: null } }>,
  likeCount: 0,
  testIds: [] as string[],
}));

vi.mock('@/lib/athletes/test-accounts', async (orig) => ({
  ...(await orig<typeof import('@/lib/athletes/test-accounts')>()),
  testAccountIds: async () => new Set(h.testIds),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const eq: Record<string, unknown> = {};
      const ins: Record<string, unknown[]> = {};
      let limit = Infinity;
      const rows = () => {
        if (table === 'feed_items') return [{ id: 'item-1', author_athlete_id: OWNER, like_count: h.likeCount }];
        let r = h.likes.filter((l) => (eq.athlete_id === undefined || l.athlete_id === eq.athlete_id));
        if (ins.athlete_id) r = r.filter((l) => ins.athlete_id.includes(l.athlete_id));
        return r.slice(0, limit);
      };
      const b: Record<string, unknown> = {
        select: () => b, is: () => b, order: () => b,
        eq: (c: string, v: unknown) => { eq[c] = v; return b; },
        in: (c: string, v: unknown[]) => { ins[c] = v; return b; },
        limit: (n: number) => { limit = n; return b; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return b;
    },
  }),
}));

const like = (athleteId: string, i: number) => ({
  feed_item_id: 'item-1', athlete_id: athleteId, created_at: `2026-11-01T06:${String(59 - i).padStart(2, '0')}:00Z`,
  athletes: { id: athleteId, name: athleteId, avatar_url: null },
});

async function get(athleteId: string) {
  const { GET } = await import('@/app/api/activities/[id]/kudos/route');
  const res = await GET(new Request(`http://x/api/activities/act-1/kudos?athleteId=${athleteId}`), { params: Promise.resolve({ id: 'act-1' }) });
  return res.json();
}

describe('GET /api/activities/[id]/kudos — same numbers as the feed card', () => {
  beforeEach(() => { h.likes = []; h.likeCount = 0; h.testIds = []; });

  it('drops a test account from the givers and the count for another member', async () => {
    h.likes = [like(TESTER, 0), like('a', 1), like('b', 2)];
    h.likeCount = 3;
    h.testIds = [TESTER];
    const body = await get('viewer');
    expect(body.count).toBe(2);
    expect(body.givers.map((g: { name: string }) => g.name)).toEqual(['a', 'b']);
  });

  it('the test account still sees its own kudos', async () => {
    h.likes = [like(TESTER, 0), like('a', 1)];
    h.likeCount = 2;
    h.testIds = [TESTER];
    const body = await get(TESTER);
    expect(body.count).toBe(2);
    expect(body.givenByMe).toBe(true);
  });

  it('givenByMe is exact for a giver past the 20-name cap', async () => {
    h.likes = Array.from({ length: 30 }, (_, i) => like(`g${i}`, i));
    h.likeCount = 30;
    const body = await get('g29');
    expect(body.givers).toHaveLength(20);
    expect(body.givers.some((g: { name: string }) => g.name === 'g29')).toBe(false);
    expect(body.givenByMe).toBe(true);
    expect(body.count).toBe(30);
  });

  it('not given is false', async () => {
    h.likes = [like('a', 0)];
    h.likeCount = 1;
    expect((await get('viewer')).givenByMe).toBe(false);
  });
});
