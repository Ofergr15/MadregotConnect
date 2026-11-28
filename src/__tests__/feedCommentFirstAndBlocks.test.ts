import { describe, expect, it } from 'vitest';
import { loadFeedContext } from '@/lib/feed/context';
import { buildFirstCommentIndex, buildCommentPreviewIndex } from '@/lib/feed/comments';
import { projectFeedItem } from '@/lib/feed/project';

// Task 155: the feed card carries the latest COMMENT_PREVIEW_COUNT comments, the
// visible count, and — for a thread longer than that — its opening comment. A member
// the viewer blocked is out of all three, exactly as GET /api/feed/comments drops them
// from the full thread.

const comment = (id: string, itemId: string, athleteId: string, at: string) => ({
  id, feed_item_id: itemId, athlete_id: athleteId, body: `c-${id}`, created_at: at,
  athletes: { id: athleteId, name: athleteId, avatar_url: null },
});

const THREAD = [
  comment('c1', 'item-1', 'alice', '2026-11-01T06:00:00Z'),
  comment('c2', 'item-1', 'bully', '2026-11-01T06:01:00Z'),
  comment('c3', 'item-1', 'carol', '2026-11-01T06:02:00Z'),
  comment('c4', 'item-1', 'dan', '2026-11-01T06:03:00Z'),
];

interface Query { table: string; ascending?: boolean; ins: Record<string, unknown[]> }

function fakeSupabase(opts: { blocked?: string[]; comments?: typeof THREAD; failFirst?: boolean } = {}) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const q: Query = { table, ins: {} };
      queries.push(q);
      const builder: Record<string, unknown> = {
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          let data: unknown[] = [];
          if (table === 'athlete_blocks') data = (opts.blocked ?? []).map((b) => ({ blocked_athlete_id: b }));
          if (table === 'feed_comments') {
            let rows = [...(opts.comments ?? THREAD)];
            if (q.ins.athlete_id) rows = rows.filter((r) => q.ins.athlete_id.includes(r.athlete_id));
            if (q.ascending === false) rows.reverse();
            if (q.ascending === true && opts.failFirst) {
              return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
            }
            data = rows;
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
        order(_col: string, o?: { ascending?: boolean }) { q.ascending = o?.ascending; return builder; },
        in(col: string, vals: unknown[]) { q.ins[col] = vals; return builder; },
      };
      for (const m of ['select', 'is', 'limit', 'eq', 'gte', 'lte', 'not']) builder[m] = () => builder;
      return builder;
    },
  };
  return { client, queries };
}

const row = (count: number) => ({
  id: 'item-1', type: 'post', author_athlete_id: 'author', body: 'x', media: [], payload: null,
  occurred_at: '2026-11-01T05:00:00Z', like_count: 0, comment_count: count, athletes: null, athlete_activities: null,
});

describe('buildFirstCommentIndex', () => {
  it('returns the opening comment only when the preview does not already start with it', () => {
    const newestFirst = [...THREAD].reverse();
    const preview = buildCommentPreviewIndex(newestFirst, null, false, 2);
    expect(preview.get('item-1')?.map((c) => c.id)).toEqual(['c3', 'c4']);
    const first = buildFirstCommentIndex(THREAD, null, false, preview);
    expect(first.get('item-1')?.id).toBe('c1');

    const shortPreview = buildCommentPreviewIndex([THREAD[1], THREAD[0]], null, false, 2);
    expect(buildFirstCommentIndex(THREAD.slice(0, 2), null, false, shortPreview).size).toBe(0);
  });
});

describe('loadFeedContext — first comment + blocked commenters', () => {
  it('ships latest 2 + the opening comment for a long thread', async () => {
    const { client } = fakeSupabase();
    const ctx = await loadFeedContext(client as never, [row(4)], { athleteId: 'viewer', isStaff: false });
    const item = projectFeedItem(row(4), ctx);
    expect(item.commentPreview.map((c) => c.id)).toEqual(['c3', 'c4']);
    expect(item.commentFirst?.id).toBe('c1');
    expect(item.commentCount).toBe(4);
  });

  it('drops a blocked commenter from the preview, the first comment and the count', async () => {
    const { client } = fakeSupabase({
      blocked: ['alice'],
    });
    const ctx = await loadFeedContext(client as never, [row(4)], { athleteId: 'viewer', isStaff: false });
    const item = projectFeedItem(row(4), ctx);
    expect(item.commentPreview.map((c) => c.id)).toEqual(['c3', 'c4']);
    // alice opened the thread but is blocked: the first VISIBLE comment is c2.
    expect(item.commentFirst?.id).toBe('c2');
    expect(item.commentCount).toBe(3);
  });

  it('a blocked commenter in the newest two leaves the preview', async () => {
    const { client } = fakeSupabase({ blocked: ['dan'] });
    const ctx = await loadFeedContext(client as never, [row(4)], { athleteId: 'viewer', isStaff: false });
    const item = projectFeedItem(row(4), ctx);
    expect(item.commentPreview.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(item.commentPreview.some((c) => c.author.athleteId === 'dan')).toBe(false);
    expect(item.commentCount).toBe(3);
  });

  it('asks for no opening comment when no thread is longer than the preview', async () => {
    const { client, queries } = fakeSupabase({ comments: THREAD.slice(0, 2) });
    const ctx = await loadFeedContext(client as never, [row(2)], { athleteId: 'viewer', isStaff: false });
    expect(queries.filter((q) => q.table === 'feed_comments' && q.ascending === true)).toHaveLength(0);
    expect('commentFirst' in projectFeedItem(row(2), ctx)).toBe(false);
  });

  it('a failed opening-comment read is no first comment, never a failed page', async () => {
    const { client } = fakeSupabase({ failFirst: true });
    const ctx = await loadFeedContext(client as never, [row(4)], { athleteId: 'viewer', isStaff: false });
    const item = projectFeedItem(row(4), ctx);
    expect(item.commentFirst).toBeUndefined();
    expect(item.commentPreview).toHaveLength(2);
  });

  it('a viewer with no athlete row (staff) blocks nobody', async () => {
    const { client, queries } = fakeSupabase({ blocked: ['alice'] });
    const ctx = await loadFeedContext(client as never, [row(4)], { athleteId: null, isStaff: true });
    expect(queries.some((q) => q.table === 'athlete_blocks')).toBe(false);
    expect(projectFeedItem(row(4), ctx).commentCount).toBe(4);
  });
});
