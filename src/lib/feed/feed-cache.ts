'use client';

import type { FeedItem } from '@/lib/feed/project';
import { APP_VERSION } from '@/lib/version';

// The club feed's first page, saved on the device so a returning member sees it
// the moment the app opens, while the fresh page loads behind it. The feed reads
// through feed-client (a real Supabase JWT), not useApi, so the SWR persistence
// in lib/swr-persist never covered it — this is that, for the one screen that
// opens the installed app.
//
// Scoped like swr-persist: to this APP_VERSION (a card renderer must never meet
// an item shape from another release) and to who is signed in (a shared phone
// must not show the previous member's club). Cleared on sign-out with the other
// identity keys.
const KEY = 'mc_feed_page_v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** localStorage is ~5 MB for the origin and shared with the session; a page with
 *  per-km splits can be large, so trim items until it fits rather than skip it. */
const MAX_BYTES = 256 * 1024;

interface Saved { v: string; id: string; at: number; items: FeedItem[]; cursor: string | null }

function identity(): string {
  const id = localStorage.getItem('athlete_id') || '';
  const email = localStorage.getItem('coach_email') || '';
  return id || email ? `${id}|${email}` : '';
}

export function readSavedFeedPage(): { items: FeedItem[]; cursor: string | null } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    const who = identity();
    if (!who || s.v !== APP_VERSION || s.id !== who || !Array.isArray(s.items) || Date.now() - s.at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s.items.length ? { items: s.items, cursor: s.cursor ?? null } : null;
  } catch {
    return null;
  }
}

export function saveFeedPage(items: FeedItem[], cursor: string | null): void {
  try {
    const who = identity();
    if (!who) return;
    let keep = items;
    let raw = '';
    // A trimmed page has no honest cursor to continue from, so the saved copy
    // carries none; the fresh load that always follows restores real paging.
    for (;;) {
      raw = JSON.stringify({ v: APP_VERSION, id: who, at: Date.now(), items: keep, cursor: keep === items ? cursor : null } satisfies Saved);
      if (raw.length <= MAX_BYTES || keep.length <= 3) break;
      keep = keep.slice(0, Math.ceil(keep.length / 2));
    }
    if (raw.length <= MAX_BYTES) localStorage.setItem(KEY, raw);
  } catch { /* private mode or full storage: the feed simply loads as before */ }
}

export function clearSavedFeedPage(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
