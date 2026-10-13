'use client';

import { fetchFeed, FEED_PAGE_SIZE } from '@/lib/feed-client';
import type { FeedItem } from '@/lib/feed/project';
import type { FeedKind } from '@/lib/feed/scope-store';

// ═════════════════════════════════════════════════════════════════════════════
// ONE FIRST PAGE PER FILTER, kept for the visit (Ofer, 2026-10-13: "the filters
// are very slow — I chose 'mine' and still saw other people's runs, then
// suddenly only mine"). Switching to a filter shows its own last page at once
// and refreshes it quietly; a filter not seen yet shows a skeleton, never the
// previous filter's runs. Opening the logo panel warms the options (prefetch).
// ═════════════════════════════════════════════════════════════════════════════

export const KIND_TYPES: Record<FeedKind, readonly string[]> = {
  all: [],
  runs: ['activity'],
  social: ['post', 'achievement', 'announcement', 'new_plan'],
};

export interface CachedPage { items: FeedItem[]; cursor: string | null; at: number }

const pages = new Map<string, CachedPage>();
const pending = new Map<string, Promise<CachedPage>>();

export const scopeKey = (kind: FeedKind, squad: string | null) => `${kind}|${squad ?? ''}`;

export function cachedScope(kind: FeedKind, squad: string | null): CachedPage | null {
  return pages.get(scopeKey(kind, squad)) ?? null;
}

export function rememberScope(kind: FeedKind, squad: string | null, items: FeedItem[], cursor: string | null): void {
  pages.set(scopeKey(kind, squad), { items, cursor, at: Date.now() });
}

/** Fetch (or join the fetch already running) for one filter's first page. */
export function loadScope(kind: FeedKind, squad: string | null): Promise<CachedPage> {
  const key = scopeKey(kind, squad);
  const running = pending.get(key);
  if (running) return running;
  const p = fetchFeed(null, FEED_PAGE_SIZE, KIND_TYPES[kind], squad)
    .then(({ items, nextCursor }) => {
      const page = { items, cursor: nextCursor, at: Date.now() };
      pages.set(key, page);
      return page;
    })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Warm filters in the background (the logo panel just opened). Fresh ones are skipped. */
export function prefetchScopes(list: Array<{ kind: FeedKind; squad: string | null }>, freshMs = 60_000): void {
  for (const s of list) {
    const c = pages.get(scopeKey(s.kind, s.squad));
    if (c && Date.now() - c.at < freshMs) continue;
    loadScope(s.kind, s.squad).catch(() => { /* the tap will try again */ });
  }
}
