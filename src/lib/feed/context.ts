import type { createServerClient } from '@/lib/supabase/server';
import {
  LIKER_SELECT,
  LIKE_PREVIEW_COUNT,
  type ProjectContext,
} from '@/lib/feed/project';
import { buildLikeIndex } from '@/lib/feed/likes';
import {
  COMMENT_SELECT,
  COMMENT_PREVIEW_COUNT,
  buildCommentPreviewIndex,
} from '@/lib/feed/comments';
import { loadFeedPlanVerdicts, type VerdictActivityRow } from '@/lib/feed/plan-verdicts';

type SupabaseServer = ReturnType<typeof createServerClient>;

export interface FeedContextViewer {
  athleteId: string | null;
  isStaff: boolean;
}

/**
 * Everything `projectFeedItem` needs BESIDES the feed row itself: who liked it,
 * whether the viewer did, the newest comments, and the plan verdict for its run.
 *
 * This exists because those four were assembled inline in `/api/feed` and nowhere
 * else, while `ProjectContext` makes all of them optional — so the routes that
 * project a single item passed `likedItemIds: new Set()` and nothing more, and got
 * a card that TypeScript was perfectly happy with and that was wrong in four ways
 * at once. Reported (65b76956) as "the likes don't appear properly": a run opened
 * from its notification showed a bare "3" where the club feed showed three faces
 * and "תל ועוד 2", and its heart was hollow no matter how many times you'd tapped
 * it, because `likedByMe` was computed against an empty set. The comment preview
 * and the plan ring were missing from that card too; nobody had filed those yet.
 *
 * Building the context is therefore a function, not a literal — one place that
 * knows the full set, so a new field lands on every surface at once instead of on
 * whichever route the author happened to be editing.
 *
 * Takes the feed rows already fetched (any shape with an `id`, optionally with the
 * embedded `athlete_activities`) so it costs one round of queries for a page of 20
 * or for a single item, and short-circuits to empty maps for an empty page.
 */
export async function loadFeedContext(
  supabase: SupabaseServer,
  rows: unknown[],
  viewer: FeedContextViewer,
): Promise<ProjectContext> {
  const base: ProjectContext = {
    viewerAthleteId: viewer.athleteId,
    viewerIsStaff: viewer.isStaff,
    likedItemIds: new Set<string>(),
    likersByItem: new Map(),
    commentsByItem: new Map(),
    planVerdictsByActivity: new Map(),
  };

  const itemIds = (rows as Array<{ id?: string } | null>)
    .map((r) => r?.id)
    .filter((id): id is string => !!id);
  if (itemIds.length === 0) return base;

  // Through `unknown`: the generated select type calls the embedded
  // `athlete_activities` an array, but it's a to-one FK join and arrives as a
  // single object — the same reason `projectFeedItem` casts its own row.
  const activityRows = (rows as unknown as Array<{ athlete_activities?: VerdictActivityRow | null }>)
    .map((r) => r.athlete_activities)
    .filter((a): a is VerdictActivityRow => !!a);

  // Likes, comment previews and plan verdicts are independent reads against
  // different tables, so they go out together rather than one after the other —
  // the feed is the app's landing page and this is on its critical path.
  const [likesRes, commentsRes, verdicts] = await Promise.all([
    // Newest-first so the preview names match what the like sheet shows at the top.
    supabase
      .from('feed_likes')
      .select(LIKER_SELECT)
      .in('feed_item_id', itemIds)
      .order('created_at', { ascending: false }),
    // Newest-first, then trimmed per item in buildCommentPreviewIndex. The row cap
    // is a safety valve against one runaway thread, not a per-item guarantee:
    // Postgres has no cheap "last N per group" here, and at club scale a page's
    // worth of comments is a couple of dozen rows. If a single item ever eats the
    // whole budget the card just shows fewer comments than it could — the count and
    // the full thread stay correct.
    supabase
      .from('feed_comments')
      .select(COMMENT_SELECT)
      .in('feed_item_id', itemIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(itemIds.length * COMMENT_PREVIEW_COUNT * 10),
    // Never throws and never rejects — a page with no plans, or a plan read that
    // fails, comes back as an empty map and the cards show no badge.
    //
    // The viewer is passed in because the ring is not public: an accuracy
    // percentage is a score on a named person, so it is graded for the person
    // looking and for staff, and simply not computed for anyone else's runs.
    // Filtering at the source rather than at render time means a stranger's score
    // never reaches the response to be dropped from later.
    loadFeedPlanVerdicts(supabase, activityRows, {
      athleteId: viewer.athleteId,
      isStaff: viewer.isStaff,
    }),
  ]);
  if (likesRes.error) throw likesRes.error;
  if (commentsRes.error) throw commentsRes.error;

  const likes = buildLikeIndex(likesRes.data || [], viewer.athleteId, LIKE_PREVIEW_COUNT);

  return {
    ...base,
    likedItemIds: likes.likedItemIds,
    likersByItem: likes.likersByItem,
    commentsByItem: buildCommentPreviewIndex(
      commentsRes.data || [],
      viewer.athleteId,
      viewer.isStaff,
      COMMENT_PREVIEW_COUNT,
    ),
    planVerdictsByActivity: verdicts,
  };
}
