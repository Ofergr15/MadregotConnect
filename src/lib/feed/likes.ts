import { projectLike, type FeedLiker } from '@/lib/feed/project';

export interface LikeIndex {
  likedItemIds: Set<string>;
  likersByItem: Map<string, FeedLiker[]>;
}

/**
 * One pass over a page's worth of like rows (already sorted newest-first)
 * resolving BOTH which items the viewer has liked AND the first `previewCap`
 * likers per item for the "ועוד N" summary — no per-item round trip. Pulled
 * out of GET /api/feed so a bug in "did I like this" or "who's shown in the
 * preview" has one place to go wrong, not one embedded in a bigger handler.
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
    if (viewerAthleteId && liker.athleteId === viewerAthleteId) likedItemIds.add(itemId);
    const bucket = likersByItem.get(itemId);
    if (!bucket) likersByItem.set(itemId, [liker]);
    else if (bucket.length < previewCap) bucket.push(liker);
  }

  return { likedItemIds, likersByItem };
}
