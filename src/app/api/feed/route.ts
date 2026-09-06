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
import {
  loadFeedPlanVerdicts,
  type FeedPlanVerdict,
  type VerdictActivityRow,
} from '@/lib/feed/plan-verdicts';
import { clampFeedLimit, parseFeedCursor } from '@/lib/feed/pagination';
import { buildLikeIndex } from '@/lib/feed/likes';
import {
  COMMENT_SELECT,
  COMMENT_PREVIEW_COUNT,
  buildCommentPreviewIndex,
  type FeedComment,
} from '@/lib/feed/comments';

export const dynamic = 'force-dynamic';

/** The feed item types a caller may ask for via `?types=`. Whitelisted rather
 *  than passed through, so the param can't be used to probe for other values. */
const FILTERABLE_TYPES = ['activity', 'post', 'achievement', 'announcement', 'new_plan'];

/**
 * GET /api/feed?cursor=<occurredAt>,<id>&limit=20&types=announcement,post
 *
 * The club feed: runs and member posts interleaved, newest first.
 *
 * Keyset (not offset) pagination on (occurred_at DESC, id DESC) — matching
 * idx_feed_items_occurred. Offset pagination would skip or duplicate items whenever a
 * new run syncs mid-scroll, which on an active club feed is constantly.
 *
 * `types` is an optional comma-separated filter. It exists for the Profile
 * screen's עידכונים deck, which needs the latest *announcements* only — reading
 * the first page of the whole feed and filtering client-side would silently show
 * nothing whenever the newest 20 items happen to be runs, which on an active
 * club is most of the time. Unknown values are dropped; a `types` that names
 * nothing valid is treated as absent rather than as "match none", so a typo
 * degrades to the full feed instead of an unexplained empty screen.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  try {
    const { searchParams } = new URL(request.url);
    const limit = clampFeedLimit(searchParams.get('limit'));

    const types = (searchParams.get('types') || '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => FILTERABLE_TYPES.includes(t));

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

    if (types.length > 0) query = query.in('type', types);

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
    let commentsByItem = new Map<string, FeedComment[]>();
    let planVerdictsByActivity = new Map<string, FeedPlanVerdict>();
    if (page.length > 0) {
      const pageIds = page.map((r: { id: string }) => r.id);
      // Through `unknown`: the generated select type calls the embedded
      // `athlete_activities` an array, but it's a to-one FK join and arrives as a
      // single object — the same reason `projectFeedItem` casts its own row.
      const activityRows = (page as unknown as Array<{ athlete_activities?: VerdictActivityRow | null }>)
        .map((r) => r.athlete_activities)
        .filter((a): a is VerdictActivityRow => !!a);

      // Likes, comment previews and plan verdicts are independent reads against
      // different tables, so they go out together rather than one after the other
      // — the feed is the app's landing page and this is on its critical path.
      const [likesRes, commentsRes, verdicts] = await Promise.all([
        supabase
          .from('feed_likes')
          .select(LIKER_SELECT)
          .in('feed_item_id', pageIds)
          .order('created_at', { ascending: false }),
        // Newest-first, then trimmed per item in buildCommentPreviewIndex. The
        // row cap is a safety valve against one runaway thread, not a per-item
        // guarantee: Postgres has no cheap "last N per group" here, and at club
        // scale a page's worth of comments is a couple of dozen rows. If a
        // single item ever eats the whole budget the card just shows fewer
        // comments than it could — the count and the full thread stay correct.
        supabase
          .from('feed_comments')
          .select(COMMENT_SELECT)
          .in('feed_item_id', pageIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(pageIds.length * COMMENT_PREVIEW_COUNT * 10),
        // Never throws and never rejects — a page with no plans, or a plan read
        // that fails, comes back as an empty map and the cards show no badge.
        loadFeedPlanVerdicts(supabase, activityRows),
      ]);
      if (likesRes.error) throw likesRes.error;
      if (commentsRes.error) throw commentsRes.error;
      planVerdictsByActivity = verdicts;

      const index = buildLikeIndex(likesRes.data || [], auth.user.athleteId, LIKE_PREVIEW_COUNT);
      likedItemIds = index.likedItemIds;
      likersByItem = index.likersByItem;
      commentsByItem = buildCommentPreviewIndex(
        commentsRes.data || [],
        auth.user.athleteId,
        auth.user.isStaff,
        COMMENT_PREVIEW_COUNT,
      );
    }

    const ctx = {
      viewerAthleteId: auth.user.athleteId,
      viewerIsStaff: auth.user.isStaff,
      likedItemIds,
      likersByItem,
      commentsByItem,
      planVerdictsByActivity,
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
