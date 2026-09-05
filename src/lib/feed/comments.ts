export const MAX_COMMENT_LENGTH = 1000;

export interface FeedCommentAuthor {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
}

export interface FeedComment {
  id: string;
  itemId: string;
  body: string;
  createdAt: string;
  author: FeedCommentAuthor;
  canDelete: boolean;
}

interface RawComment {
  id: string;
  feed_item_id: string;
  athlete_id: string;
  body: string;
  created_at: string;
  athletes?: { id: string; name: string | null; avatar_url: string | null } | null;
}

export function projectComment(
  value: unknown,
  viewerAthleteId: string | null,
  viewerIsStaff: boolean,
): FeedComment {
  const row = value as RawComment;
  return {
    id: row.id,
    itemId: row.feed_item_id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      athleteId: row.athlete_id,
      name: row.athletes?.name || 'Unknown',
      avatarUrl: row.athletes?.avatar_url || null,
    },
    // Author may remove their own; staff may remove any (moderation, PRD §19).
    canDelete: viewerIsStaff || row.athlete_id === viewerAthleteId,
  };
}

/**
 * Columns every comment query selects. Shared by /api/feed/comments (the full
 * thread) and /api/feed (the inline preview) so the two can't drift — the same
 * arrangement `LIKER_SELECT` has in project.ts.
 */
export const COMMENT_SELECT = `
  id, feed_item_id, athlete_id, body, created_at,
  athletes ( id, name, avatar_url )
`;

/** How many comments ride along on a feed card; the rest load on tap. */
export const COMMENT_PREVIEW_COUNT = 2;

/**
 * The newest `previewCap` comments per item, from one page-wide query — the
 * comment-side twin of `buildLikeIndex`.
 *
 * Takes rows sorted NEWEST-first (so a 60-comment thread doesn't have to be read
 * in full to find its tail) and returns each bucket flipped back to
 * oldest-first, because a comment preview has to read as a conversation.
 */
export function buildCommentPreviewIndex(
  rawComments: unknown[],
  viewerAthleteId: string | null,
  viewerIsStaff: boolean,
  previewCap: number,
): Map<string, FeedComment[]> {
  const byItem = new Map<string, FeedComment[]>();

  if (previewCap < 1) return byItem;

  for (const raw of rawComments) {
    const comment = projectComment(raw, viewerAthleteId, viewerIsStaff);
    const bucket = byItem.get(comment.itemId);
    if (!bucket) byItem.set(comment.itemId, [comment]);
    else if (bucket.length < previewCap) bucket.push(comment);
  }

  for (const bucket of byItem.values()) bucket.reverse();
  return byItem;
}

export type CommentValidation = { ok: true; body: string } | { ok: false; error: string };

/** Trims and validates a raw comment body — empty and over-length both rejected. */
export function validateCommentBody(raw: unknown): CommentValidation {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) return { ok: false, error: 'Comment cannot be empty' };
  if (body.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `Comment is too long (max ${MAX_COMMENT_LENGTH})` };
  }
  return { ok: true, body };
}
