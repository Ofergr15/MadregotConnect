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
