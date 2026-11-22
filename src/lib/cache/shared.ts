import { revalidateTag, unstable_cache } from 'next/cache';

/**
 * Shared (cross-request, cross-instance) cache for data that is the SAME FOR
 * EVERY MEMBER — PERF-BASELINE §8 layer 2.
 *
 * RULES — read before adding anything here:
 *  - NEVER personal data. No athlete names/emails/paces, no per-viewer state, no
 *    roster. That is why `/api/groups` (embeds every member's email for staff) is
 *    NOT here, and nothing from `athlete_activities` ever is. Layer 3 data stays
 *    per-account (swr-persist, native ResponseCache) only.
 *  - Cache the RAW ROWS of a data function, never a Response. Auth gates,
 *    per-viewer projection (drafts for staff only, likes, `me`) and masking all
 *    still run per request, after the cached read.
 *  - Every writer of a cached table calls `invalidateShared(tag)` after it
 *    writes. `sharedCacheWriters.test.ts` scans src/ for writes to these tables
 *    and fails for a file that doesn't — so a new writer can't forget.
 */

export const SHARED_TAGS = {
  programWeeks: 'program-weeks',
  events: 'events',
  clubUpdates: 'club-updates',
} as const;
export type SharedTag = (typeof SHARED_TAGS)[keyof typeof SHARED_TAGS];

/** Which table feeds which tag — the writer scan reads this. */
export const SHARED_TABLES: Record<string, SharedTag> = {
  program_weeks: SHARED_TAGS.programWeeks,
  events: SHARED_TAGS.events,
  club_updates: SHARED_TAGS.clubUpdates,
};

/**
 * Wrap a data function. `keyParts` + the function's arguments form the key, so
 * every argument must be a plain serialisable value (no Supabase client — build
 * it inside).
 */
export function sharedCache<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts: string[],
  opts: { tag: SharedTag; revalidate: number },
): (...args: A) => Promise<R> {
  const cached = unstable_cache(fn, keyParts, { tags: [opts.tag], revalidate: opts.revalidate });
  return async (...args: A) => {
    try {
      return await cached(...args);
    } catch (err) {
      // Outside the Next runtime (unit tests, scripts) there is no incremental
      // cache: read straight through. Any other error is the data function's own.
      if (err instanceof Error && err.message.includes('incrementalCache missing')) return fn(...args);
      throw err;
    }
  };
}

/**
 * Drop a tag NOW: `{ expire: 0 }` so the very next read is fresh, not a stale
 * copy served while it revalidates — a coach who just saved an event must see it.
 * Never throws: a write that succeeded must not 500 because invalidation
 * couldn't run (e.g. outside a request); the TTL is the backstop.
 */
export function invalidateShared(tag: SharedTag): void {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch (err) {
    console.warn('[shared-cache] revalidateTag failed', tag, err instanceof Error ? err.message : err);
  }
}
