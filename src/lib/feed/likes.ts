import type { createServerClient } from '@/lib/supabase/server';
import { projectLike, type FeedLiker } from '@/lib/feed/project';

export interface LikeIndex {
  /** Items the viewer has already liked — drives the filled ❤️ on the card. */
  likedItemIds: Set<string>;
  /** feed_item_id -> the newest few likers, for the "Tal and 3 others" row. */
  likersByItem: Map<string, FeedLiker[]>;
}

/**
 * One page of feed cards' like state, from a single page-wide query — the
 * like-side twin of `buildCommentPreviewIndex`.
 *
 * Takes rows sorted NEWEST-first and keeps the first `previewCap` per item, so a
 * run with 200 likes costs the same to render as one with three. Buckets are
 * tracked per item: a full bucket on one card never starves another.
 *
 * A row whose joined athlete is missing is skipped rather than thrown on — the
 * feed is the landing page, and one orphaned like shouldn't 500 it.
 */
export function buildLikeIndex(
  rawLikes: unknown[],
  viewerAthleteId: string | null,
  previewCap: number,
): LikeIndex {
  const likedItemIds = new Set<string>();
  const likersByItem = new Map<string, FeedLiker[]>();

  for (const raw of rawLikes) {
    const projected = projectLike(raw);
    if (!projected) continue;
    const { itemId, liker } = projected;

    // Guarded on viewerAthleteId, not just on equality: staff with no athlete row
    // have a null id, and null === null would mark every malformed like as theirs.
    if (viewerAthleteId && liker.athleteId === viewerAthleteId) likedItemIds.add(itemId);

    const bucket = likersByItem.get(itemId);
    if (!bucket) likersByItem.set(itemId, [liker]);
    else if (bucket.length < previewCap) bucket.push(liker);
  }

  return { likedItemIds, likersByItem };
}

/**
 * The bridge between the two places a member can react to a run.
 *
 * There used to be two tables. `feed_likes` backs the ❤️ on a feed card and
 * keeps `feed_items.like_count` in sync through a trigger; `activity_kudos`
 * backed the 👍 on a push notification and the Notification Center row, keyed on
 * the activity rather than the feed item. Same gesture, same pair of people,
 * two rows that never saw each other: the feed said 0 for a run that had three
 * kudos, giving kudos from a push left the card un-hearted, and un-hearting the
 * card left the kudos standing.
 *
 * `feed_likes` won because it is the one with the counter trigger and the one
 * the feed already reads. Everything activity-keyed now resolves through here
 * (migration 088 backfilled the rows that existed).
 *
 * ⚠️ An activity has a feed item because `trg_feed_item_for_activity` creates
 * one on sync — but only for activities synced after migration 047. A run older
 * than the feed has nowhere to hang a like, so every function here reports that
 * honestly instead of inventing an item.
 */

/** One activity's feed item: what a like on that run actually attaches to. */
export interface ActivityFeedItem {
  id: string;
  authorAthleteId: string | null;
}

/**
 * The feed item for one activity, or null when the run predates the feed (or its
 * item was deleted).
 *
 * Deleted items are excluded: a like on a removed card would be invisible and
 * would still bump a counter nobody can see.
 */
export async function feedItemForActivity(
  supabase: ReturnType<typeof createServerClient>,
  activityId: string,
): Promise<ActivityFeedItem | null> {
  const { data, error } = await supabase
    .from('feed_items')
    .select('id, author_athlete_id')
    .eq('type', 'activity')
    .eq('activity_id', activityId)
    .is('deleted_at', null)
    .order('occurred_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string, authorAthleteId: (data.author_athlete_id as string) ?? null };
}

/**
 * Which of `activityIds` this athlete has already reacted to.
 *
 * Two queries for the whole page, not one per row — this feeds the Notification
 * Center's kudos buttons, and there can be 50 of them in one window. PostgREST
 * has no join-and-filter in a single request across `feed_items` → `feed_likes`
 * in the direction needed here, so the item ids come first and the likes second.
 *
 * Returns null — not an empty set — if either query fails. The caller has to be
 * able to tell "reacted to nothing" from "we don't know", because a kudos button
 * that wrongly renders as un-given turns the next tap into a DELETE of a real
 * reaction.
 */
export async function likedActivityIds(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  activityIds: string[],
): Promise<Set<string> | null> {
  if (activityIds.length === 0) return new Set();

  const { data: items, error: itemsError } = await supabase
    .from('feed_items')
    .select('id, activity_id')
    .eq('type', 'activity')
    .in('activity_id', activityIds)
    .is('deleted_at', null)
    .returns<Array<{ id: string; activity_id: string }>>();
  if (itemsError) return null;

  const activityByItem = new Map((items || []).map((row) => [row.id, row.activity_id]));
  if (activityByItem.size === 0) return new Set();

  const { data: likes, error: likesError } = await supabase
    .from('feed_likes')
    .select('feed_item_id')
    .eq('athlete_id', athleteId)
    .in('feed_item_id', [...activityByItem.keys()])
    .returns<Array<{ feed_item_id: string }>>();
  if (likesError) return null;

  const liked = new Set<string>();
  for (const like of likes || []) {
    const activityId = activityByItem.get(like.feed_item_id);
    if (activityId) liked.add(activityId);
  }
  return liked;
}
