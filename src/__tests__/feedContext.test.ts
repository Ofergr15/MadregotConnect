import { describe, expect, it } from 'vitest';
import { loadFeedContext } from '@/lib/feed/context';

// A single feed card opened from a push notification used to be projected with a
// hand-written context — `likedItemIds: new Set()` and nothing else — so its heart
// was hollow however many times the viewer had liked it and its like row showed a
// bare count instead of faces and names (report 65b76956). These lock the shape of
// the context that both the club feed and the single-item route now share.

type Handler = () => { data: unknown[]; error: null };

/**
 * A minimal stand-in for the PostgREST builder: every filter/order/limit returns
 * `this`, and the builder is awaited directly, which is what supabase-js does (a
 * PostgrestBuilder is a thenable, not a Promise).
 */
function fakeSupabase(tables: Record<string, Handler>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        calls.push(table);
        const builder: Record<string, unknown> = {
          then(resolve: (v: unknown) => unknown) {
            const handler = tables[table];
            return Promise.resolve(handler ? handler() : { data: [], error: null }).then(resolve);
          },
        };
        for (const method of ['select', 'in', 'is', 'order', 'limit', 'eq', 'gte', 'lte']) {
          builder[method] = () => builder;
        }
        return builder;
      },
    },
  };
}

const likeRow = (itemId: string, athleteId: string, name: string) => ({
  feed_item_id: itemId,
  created_at: '2026-09-12T06:00:00Z',
  athletes: { id: athleteId, name, avatar_url: null },
});

describe('loadFeedContext', () => {
  it('resolves the viewer\'s own like and the liker preview for a SINGLE item', async () => {
    const { client } = fakeSupabase({
      feed_likes: () => ({
        data: [
          likeRow('item-1', 'viewer', 'Viewer Runner'),
          likeRow('item-1', 'other', 'Other Runner'),
        ],
        error: null,
      }),
    });

    const ctx = await loadFeedContext(client as never, [{ id: 'item-1' }], {
      athleteId: 'viewer',
      isStaff: false,
    });

    // Both halves of the bug: the filled heart and the named row.
    expect(ctx.likedItemIds.has('item-1')).toBe(true);
    expect(ctx.likersByItem?.get('item-1')?.map(l => l.name)).toEqual([
      'Viewer Runner',
      'Other Runner',
    ]);
  });

  it('reads likes, comments and plan verdicts rather than defaulting them away', async () => {
    const { client, calls } = fakeSupabase({});
    const ctx = await loadFeedContext(client as never, [{ id: 'item-1' }], {
      athleteId: 'viewer',
      isStaff: false,
    });
    expect(calls).toContain('feed_likes');
    expect(calls).toContain('feed_comments');
    // Present and empty, never undefined — an absent map and an empty one render
    // the same, which is how the single-item route hid this for so long.
    expect(ctx.likersByItem?.size).toBe(0);
    expect(ctx.commentsByItem?.size).toBe(0);
    expect(ctx.planVerdictsByActivity?.size).toBe(0);
  });

  it('carries the viewer through so canDelete and the plan ring can be graded', async () => {
    const { client } = fakeSupabase({});
    const ctx = await loadFeedContext(client as never, [{ id: 'item-1' }], {
      athleteId: 'viewer',
      isStaff: true,
    });
    expect(ctx.viewerAthleteId).toBe('viewer');
    expect(ctx.viewerIsStaff).toBe(true);
  });

  it('queries nothing for an empty page', async () => {
    const { client, calls } = fakeSupabase({});
    const ctx = await loadFeedContext(client as never, [], { athleteId: 'viewer', isStaff: false });
    expect(calls).toEqual([]);
    expect(ctx.likedItemIds.size).toBe(0);
  });

  it('ignores rows with no id instead of asking PostgREST for `in.()`', async () => {
    const { client, calls } = fakeSupabase({});
    await loadFeedContext(client as never, [null, {}, undefined], {
      athleteId: 'viewer',
      isStaff: false,
    });
    expect(calls).toEqual([]);
  });
});
