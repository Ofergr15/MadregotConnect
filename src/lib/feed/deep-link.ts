/**
 * Which feed item a push notification is asking the app to open.
 *
 * There are two kinds of link because there are two kinds of news. A run gets
 * announced by its ACTIVITY id (`?activity=`, and `?kudos=` in every row written
 * before the param was renamed) — the feed_item for it always exists, created by
 * trg_feed_item_for_activity (migration 047). A like, a comment, a new post and
 * the "see it in the feed" link on a profile are about the ITEM, and a post has
 * no activity behind it at all, so those carry the feed_item id (`?item=`).
 *
 * Every sender already emitted both spellings; `/feed` only ever read the first,
 * so a comment on last week's run dropped the reader at the top of the feed.
 * Keeping the reading here, next to `FOCUS_PARAMS`, is what lets a test hold the
 * senders and this resolver to the same list.
 */

/** Every query param a notification may deep-link the feed with. */
export const FOCUS_PARAMS = ['activity', 'kudos', 'item'] as const;

export interface FeedFocus {
  /** How to resolve `id`: an athlete_activities id, or a feed_items id. */
  by: 'activity' | 'item';
  id: string;
}

/**
 * The item to pin, or null for a plain visit to the feed. An activity id wins
 * when a link carries both: it is the more specific of the two, and it is the
 * one a run's own push sends.
 */
export function feedFocusFromParams(params: { get(name: string): string | null }): FeedFocus | null {
  const activityId = params.get('activity') || params.get('kudos');
  if (activityId) return { by: 'activity', id: activityId };
  const itemId = params.get('item');
  if (itemId) return { by: 'item', id: itemId };
  return null;
}
