import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem, type FeedItem } from '@/lib/feed/project';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 40;

/**
 * GET /api/feed?cursor=<occurredAt>,<id>&limit=15
 *
 * The club feed: runs and member posts interleaved, newest first.
 *
 * Keyset (not offset) pagination on (occurred_at DESC, id DESC) — matching
 * idx_feed_items_occurred. Offset pagination would skip or duplicate items whenever a
 * new run syncs mid-scroll, which on an active club feed is constantly.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    );
    const cursor = searchParams.get('cursor');

    const supabase = createServerClient();

    let query = supabase
      .from('feed_items')
      .select(FEED_SELECT)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1); // one extra row tells us whether more pages exist

    // Cursor is "<iso timestamp>,<uuid>": strictly-after in the composite sort order.
    if (cursor) {
      const idx = cursor.lastIndexOf(',');
      const cursorTime = idx === -1 ? cursor : cursor.slice(0, idx);
      const cursorId = idx === -1 ? '' : cursor.slice(idx + 1);
      if (!Number.isFinite(Date.parse(cursorTime))) {
        return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
      }
      query = cursorId
        ? query.or(
            `occurred_at.lt.${cursorTime},and(occurred_at.eq.${cursorTime},id.lt.${cursorId})`,
          )
        : query.lt('occurred_at', cursorTime);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const page = (rows || []).slice(0, limit);
    const hasMore = (rows || []).length > limit;

    // Resolve the caller's likes for this page in ONE query rather than per item.
    const likedItemIds = new Set<string>();
    if (auth.user.athleteId && page.length > 0) {
      const { data: likes } = await supabase
        .from('feed_likes')
        .select('feed_item_id')
        .eq('athlete_id', auth.user.athleteId)
        .in(
          'feed_item_id',
          page.map((r: { id: string }) => r.id),
        );
      for (const l of likes || []) likedItemIds.add(l.feed_item_id);
    }

    const ctx = {
      viewerAthleteId: auth.user.athleteId,
      viewerIsStaff: auth.user.isStaff,
      likedItemIds,
    };

    const items: FeedItem[] = page.map((row) => projectFeedItem(row as never, ctx));

    const last = page[page.length - 1] as { occurred_at: string; id: string } | undefined;
    const nextCursor = hasMore && last ? `${last.occurred_at},${last.id}` : null;

    return NextResponse.json({ items, nextCursor });
  } catch (err: unknown) {
    console.error('Feed fetch error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed to load feed' }, { status: 500 });
  }
}
