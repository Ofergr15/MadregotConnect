import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Test-account isolation (migration 201) on the three surfaces the first pass left
 * open: club records, like/comment lists (+ their counts), and feed paging.
 * See docs/contracts/test-account-isolation.md.
 */

const h = vi.hoisted(() => ({
  testIds: new Set<string>(),
  user: { athleteId: 'dana' as string | null, isStaff: false, name: 'x' },
  tables: {} as Record<string, unknown[]>,
  clubInput: null as null | { athletes: { id: string }[] },
}));

vi.mock('@/lib/athletes/test-accounts', async (orig) => ({
  ...(await orig<typeof import('@/lib/athletes/test-accounts')>()),
  testAccountIds: async () => new Set(h.testIds),
}));

/** PostgREST stand-in: filters `in`/`eq`/`lt`(cursor via `or`) on plain rows, thenable. */
function fakeDb() {
  return {
    from(table: string) {
      let rows = [...(h.tables[table] || [])] as Record<string, unknown>[];
      let limit = Infinity;
      const b: Record<string, unknown> = {
        then(res: (v: unknown) => unknown) {
          return Promise.resolve({ data: rows.slice(0, limit), error: null }).then(res);
        },
      };
      const self = () => b;
      for (const m of ['select', 'order', 'is', 'gte', 'not', 'range', 'returns', 'maybeSingle']) b[m] = self;
      b.in = (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return b; };
      b.eq = (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === undefined || r[k] === v); return b; };
      b.limit = (n: number) => { limit = n; return b; };
      b.or = (expr: string) => {
        const t = /occurred_at\.lt\.([^,]+)/.exec(expr)![1];
        rows = rows.filter((r) => String(r.occurred_at) < t);
        return b;
      };
      return b;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb() }));
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: h.user }),
  requireAthlete: async () => ({ ok: true, user: h.user }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/auth/pending-athletes', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/pending-athletes')>()),
  pendingAthleteIds: async () => new Set<string>(),
  isPendingAthlete: async () => false,
}));
vi.mock('@/lib/feed/plan-verdicts', () => ({ loadFeedPlanVerdicts: async () => new Map() }));
vi.mock('@/lib/activities/quality-name', () => ({ qualityNames: async () => new Map(), qualityNamesForPage: async () => new Map() }));
vi.mock('@/lib/supabase/paginate', () => ({ fetchAllRows: async () => [] }));
vi.mock('@/lib/prs/exclusions-store', () => ({ readAllPrExclusions: async () => new Map() }));
vi.mock('@/lib/prs/club-records', async (orig) => {
  const actual = await orig<typeof import('@/lib/prs/club-records')>();
  return {
    ...actual,
    computeClubRecords: (input: { athletes: { id: string }[] }) => {
      h.clubInput = input;
      return actual.computeClubRecords(input as never);
    },
  };
});

import { computeClubRecordsSnapshot } from '@/lib/prs/club-records-store';
import { loadFeedContext } from '@/lib/feed/context';
import { projectFeedItem } from '@/lib/feed/project';
import { GET as feedGET } from '@/app/api/feed/route';
import { GET as likesGET } from '@/app/api/feed/likes/route';
import { GET as commentsGET } from '@/app/api/feed/comments/route';

const MEMBER = { athleteId: 'dana', isStaff: false, name: 'Dana' };
const SELF = { athleteId: 'qa', isStaff: false, name: 'QA' };
const STAFF = { athleteId: 'coach', isStaff: true, name: 'Coach' };

beforeEach(() => {
  h.testIds = new Set(['qa']);
  h.user = MEMBER;
  h.tables = {};
  h.clubInput = null;
});

describe('club records snapshot', () => {
  beforeEach(() => {
    h.tables.athletes = [
      { id: 'qa', name: 'QA', group_id: null, gender: null },
      { id: 'dana', name: 'Dana', group_id: null, gender: null },
    ];
  });

  it('excludes test accounts for everyone (shared snapshot)', async () => {
    const snap = await computeClubRecordsSnapshot(fakeDb() as never);
    expect(snap.athleteCount).toBe(1);
    expect(h.clubInput!.athletes.map((a) => a.id)).toEqual(['dana']);
  });

  it('fails open: no test ids, nobody excluded', async () => {
    h.testIds = new Set();
    const snap = await computeClubRecordsSnapshot(fakeDb() as never);
    expect(snap.athleteCount).toBe(2);
  });
});

const like = (item: string, id: string) => ({
  feed_item_id: item, athlete_id: id, created_at: '2026-11-01T00:00:00Z', athletes: { id, name: id, avatar_url: null },
});
const comment = (item: string, id: string) => ({
  id: `c-${id}`, feed_item_id: item, athlete_id: id, body: 'hi', created_at: '2026-11-01T00:00:00Z',
  athletes: { id, name: id, avatar_url: null },
});

describe('likes and comments on a feed item', () => {
  beforeEach(() => {
    h.tables.feed_likes = [like('i1', 'qa'), like('i1', 'omer')];
    h.tables.feed_comments = [comment('i1', 'qa'), comment('i1', 'omer')];
  });

  const card = async (viewer: typeof MEMBER) => {
    const row = { id: 'i1', type: 'post', author_athlete_id: 'omer', like_count: 2, comment_count: 2, occurred_at: '2026-11-01T00:00:00Z' };
    const ctx = await loadFeedContext(fakeDb() as never, [row], viewer);
    return projectFeedItem(row as never, ctx);
  };

  it('a member sees neither the like nor the comment, and the counts match', async () => {
    const item = await card(MEMBER);
    expect(item.likePreview.map((l) => l.athleteId)).toEqual(['omer']);
    expect(item.commentPreview.map((c) => c.author.athleteId)).toEqual(['omer']);
    expect(item.likeCount).toBe(1);
    expect(item.commentCount).toBe(1);
  });

  it('the test account sees its own', async () => {
    const item = await card(SELF);
    expect(item.likePreview).toHaveLength(2);
    expect(item.commentPreview).toHaveLength(2);
    expect(item.likeCount).toBe(2);
    expect(item.commentCount).toBe(2);
  });

  it('staff see everything', async () => {
    const item = await card(STAFF);
    expect(item.likeCount).toBe(2);
    expect(item.commentCount).toBe(2);
    expect(item.likePreview).toHaveLength(2);
  });

  const lists = async () => {
    const likes = await (await likesGET(new Request('http://x/api/feed/likes?itemId=i1'))).json();
    const comments = await (await commentsGET(new Request('http://x/api/feed/comments?itemId=i1'))).json();
    return { likers: likes.likers.length, comments: comments.comments.length };
  };

  it('the full lists: member / self / staff', async () => {
    h.user = MEMBER;
    expect(await lists()).toEqual({ likers: 1, comments: 1 });
    h.user = SELF;
    expect(await lists()).toEqual({ likers: 2, comments: 2 });
    h.user = STAFF;
    expect(await lists()).toEqual({ likers: 2, comments: 2 });
  });
});

describe('feed paging with test accounts filtered', () => {
  // Feed item ids are uuids (the cursor parser rejects anything else).
  const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c', D = '00000000-0000-4000-8000-00000000000d';
  // Newest first: the first page (limit 2) is entirely the test account's.
  beforeEach(() => {
    h.tables.feed_items = [
      { id: A, type: 'post', author_athlete_id: 'qa', occurred_at: '2026-11-05T00:00:00Z', like_count: 0, comment_count: 0 },
      { id: B, type: 'post', author_athlete_id: 'qa', occurred_at: '2026-11-04T00:00:00Z', like_count: 0, comment_count: 0 },
      { id: C, type: 'post', author_athlete_id: 'omer', occurred_at: '2026-11-03T00:00:00Z', like_count: 0, comment_count: 0 },
      { id: D, type: 'post', author_athlete_id: 'omer', occurred_at: '2026-11-02T00:00:00Z', like_count: 0, comment_count: 0 },
    ];
  });

  const page = async (cursor?: string) => {
    const url = `http://x/api/feed?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    return (await feedGET(new Request(url))).json() as Promise<{ items: { id: string }[]; nextCursor: string | null }>;
  };

  it('an emptied page still returns a cursor, and the next page advances', async () => {
    const p1 = await page();
    expect(p1.items).toEqual([]);
    expect(p1.nextCursor).toBe(`2026-11-04T00:00:00Z,${B}`);
    const p2 = await page(p1.nextCursor!);
    expect(p2.items.map((i) => i.id)).toEqual([C, D]);
    expect(p2.nextCursor).toBeNull();
  });

  it('the test account pages through its own items normally', async () => {
    h.user = SELF;
    const p1 = await page();
    expect(p1.items.map((i) => i.id)).toEqual([A, B]);
    const p2 = await page(p1.nextCursor!);
    expect(p2.items.map((i) => i.id)).toEqual([C, D]);
  });
});
