import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import {
  FEED_SELECT,
  LIKER_SELECT,
  LIKE_PREVIEW_COUNT,
  projectFeedItem,
  type FeedItem,
  type FeedLiker,
} from '@/lib/feed/project';
import { clampFeedLimit, parseFeedCursor } from '@/lib/feed/pagination';
import { buildLikeIndex } from '@/lib/feed/likes';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed?cursor=<occurredAt>,<id>&limit=20
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
    const limit = clampFeedLimit(searchParams.get('limit'));

    let parsedCursor;
    try {
      parsedCursor = parseFeedCursor(searchParams.get('cursor'));
    } catch {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }

    const supabase = createServerClient();

    let query = supabase
      .from('feed_items')
      .select(FEED_SELECT)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1); // one extra row tells us whether more pages exist

    // Cursor is "<iso timestamp>,<uuid>": strictly-after in the composite sort order.
    if (parsedCursor) {
      query = parsedCursor.id
        ? query.or(
            `occurred_at.lt.${parsedCursor.time},and(occurred_at.eq.${parsedCursor.time},id.lt.${parsedCursor.id})`,
          )
        : query.lt('occurred_at', parsedCursor.time);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const page = (rows || []).slice(0, limit);
    const hasMore = (rows || []).length > limit;

    // One query resolves BOTH the caller's likes and the "תל ועוד 3" preview for
    // every item on the page — no per-item round trip. Newest-first so the preview
    // names match what the like sheet shows at the top.
    let likedItemIds = new Set<string>();
    let likersByItem = new Map<string, FeedLiker[]>();
    if (page.length > 0) {
      const { data: likes, error: likesError } = await supabase
        .from('feed_likes')
        .select(LIKER_SELECT)
        .in(
          'feed_item_id',
          page.map((r: { id: string }) => r.id),
        )
        .order('created_at', { ascending: false });
      if (likesError) throw likesError;

      const index = buildLikeIndex(likes || [], auth.user.athleteId, LIKE_PREVIEW_COUNT);
      likedItemIds = index.likedItemIds;
      likersByItem = index.likersByItem;
    }

    const ctx = {
      viewerAthleteId: auth.user.athleteId,
      viewerIsStaff: auth.user.isStaff,
      likedItemIds,
      likersByItem,
    };

    const items: FeedItem[] = page.map((row) => projectFeedItem(row, ctx));

    const last = page[page.length - 1] as { occurred_at: string; id: string } | undefined;
    const nextCursor = hasMore && last ? `${last.occurred_at},${last.id}` : null;

    return NextResponse.json({ items, nextCursor });
  } catch (err: unknown) {
    console.error('Feed fetch error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed to load feed' }, { status: 500 });
  }
}
