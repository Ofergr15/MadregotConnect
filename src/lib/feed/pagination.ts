export const DEFAULT_FEED_LIMIT = 20;
export const MAX_FEED_LIMIT = 40;

/** Clamps the client-requested page size into [1, MAX_FEED_LIMIT], falling back to the default for anything unparseable (NaN) or non-positive (0, negative). */
export function clampFeedLimit(raw: string | null): number {
  const parsed = parseInt(raw || String(DEFAULT_FEED_LIMIT), 10) || DEFAULT_FEED_LIMIT;
  return Math.min(MAX_FEED_LIMIT, Math.max(1, parsed));
}

export type FeedCursor = { time: string; id: string } | null;

/**
 * Parses the "<iso timestamp>,<uuid>" keyset cursor. Returns `null` for no
 * cursor at all, or throws for a cursor whose time part isn't a real date —
 * the route turns that into a 400 rather than silently querying with an
 * invalid boundary.
 */
export function parseFeedCursor(raw: string | null): FeedCursor {
  if (!raw) return null;
  const idx = raw.lastIndexOf(',');
  const time = idx === -1 ? raw : raw.slice(0, idx);
  const id = idx === -1 ? '' : raw.slice(idx + 1);
  if (!Number.isFinite(Date.parse(time))) {
    throw new Error('Invalid cursor');
  }
  return { time, id };
}
