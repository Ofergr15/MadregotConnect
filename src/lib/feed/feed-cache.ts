'use client';

import type { FeedActivity, FeedAuthor, FeedItem, FeedLiker, FeedMedia } from '@/lib/feed/project';
import type { FeedComment } from '@/lib/feed/comments';
import { APP_VERSION } from '@/lib/version';

// The club feed's first page, saved on the device so a returning member sees it
// the moment the app opens, while the fresh page loads behind it. The feed reads
// through feed-client (a real Supabase JWT), not useApi, so the SWR persistence
// in lib/swr-persist never covered it — this is that, for the one screen that
// opens the installed app.
//
// Scoped to who is signed in (a shared phone must not show the previous member's
// club) and cleared on sign-out with the other identity keys.
//
// It SURVIVES a new release. It used to be dropped on every APP_VERSION change, and
// with a release a day that made every member's first open of the day the cold one
// (lab, 2026-10-16: first card 1.9 s against 0.35 s warm). What the version check
// guarded against, a card renderer meeting an item shape it does not expect, is now
// checked per item (`currentShape`): a page from another release is shown only when
// every item has every field the current types call required, with the right kind
// of value, and anything that can't be checked that way (the plan badge, the
// cursor) is left for the fresh page, which always follows within a second or two.
// A change that keeps the shape but changes what a field MEANS bumps FEED_SHAPE.
const KEY = 'mc_feed_page_v1';
/** Bump to drop every saved page on the next open (a change of meaning, not of shape). */
const FEED_SHAPE = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** localStorage is ~5 MB for the origin and shared with the session; a page with
 *  per-km splits can be large, so trim items until it fits rather than skip it. */
const MAX_BYTES = 256 * 1024;

interface Saved { v: string; shape?: number; id: string; at: number; items: FeedItem[]; cursor: string | null }

// ── The shape check ──────────────────────────────────────────────────────────
// One entry per REQUIRED field of each type, enforced by the compiler: a new
// required field on FeedItem / FeedActivity / FeedAuthor fails the build here until
// it is listed, so the check can't fall behind the types it protects.
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type Check = (v: unknown) => boolean;
const str: Check = v => typeof v === 'string';
const num: Check = v => typeof v === 'number' && Number.isFinite(v);
const bool: Check = v => typeof v === 'boolean';
const arr: Check = v => Array.isArray(v);
const obj: Check = v => !!v && typeof v === 'object' && !Array.isArray(v);
const orNull = (c: Check): Check => v => v === null || c(v);
const each = (c: Check): Check => v => Array.isArray(v) && v.every(c);
const fields = <T,>(spec: { [K in RequiredKeys<T>]: Check }): Check =>
  v => obj(v) && Object.entries(spec).every(([k, c]) => (c as Check)((v as Record<string, unknown>)[k]));

const authorOk = fields<FeedAuthor>({ athleteId: orNull(str), name: str, avatarUrl: orNull(str), groupName: orNull(str) });
const likerOk = fields<FeedLiker>({ athleteId: str, name: str, avatarUrl: orNull(str) });
const commentOk = fields<FeedComment>({
  id: str, itemId: str, body: str, createdAt: str, canDelete: bool,
  author: fields<FeedComment['author']>({ athleteId: str, name: str, avatarUrl: orNull(str) }),
});
const mediaOk = fields<FeedMedia>({ path: str, url: str, w: orNull(num), h: orNull(num) });
const point = fields<{ lat: number; lng: number }>({ lat: num, lng: num });
const activityOk = fields<FeedActivity>({
  id: str, athleteId: str, garminActivityId: orNull(num), activityName: orNull(str), activityType: orNull(str),
  startTime: str, distance: num, duration: num, movingDuration: orNull(num), averagePace: orNull(num),
  averageHr: orNull(num), maxHr: orNull(num), calories: orNull(num), elevationGain: orNull(num),
  locationName: orNull(str), perceivedRpe: orNull(num), perceivedFeel: orNull(num),
  routePreview: orNull(each(point)), hasRoute: bool, paceBands: orNull(each(num)),
  // Checked only for being there; another release's verdict is never shown (below).
  planVerdict: () => true,
});
const itemOk = fields<FeedItem>({
  id: str, type: str, author: authorOk, body: orNull(str), media: each(mediaOk), payload: orNull(obj),
  occurredAt: str, likeCount: num, commentCount: num, likedByMe: bool, likePreview: each(likerOk),
  commentPreview: each(commentOk), canDelete: bool, activity: orNull(activityOk),
});

/** Every item fits the current types: the page can be shown although another release saved it. */
export function currentShape(items: unknown[]): items is FeedItem[] {
  return items.every(itemOk);
}

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
    const sameRelease = s.v === APP_VERSION;
    if (
      !who || s.id !== who || !Array.isArray(s.items) || Date.now() - s.at > MAX_AGE_MS
      || (s.shape ?? 1) !== FEED_SHAPE || (!sameRelease && !currentShape(s.items))
    ) {
      localStorage.removeItem(KEY);
      return null;
    }
    if (!s.items.length) return null;
    if (sameRelease) return { items: s.items, cursor: s.cursor ?? null };
    // Another release's page: its plan badges (a summary whose shape this file does
    // not check) and its cursor (which the new server may read differently) wait
    // for the fresh page.
    return {
      items: s.items.map(it => (it.activity ? { ...it, activity: { ...it.activity, planVerdict: null } } : it)),
      cursor: null,
    };
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
      raw = JSON.stringify({ v: APP_VERSION, shape: FEED_SHAPE, id: who, at: Date.now(), items: keep, cursor: keep === items ? cursor : null } satisfies Saved);
      if (raw.length <= MAX_BYTES || keep.length <= 3) break;
      keep = keep.slice(0, Math.ceil(keep.length / 2));
    }
    if (raw.length <= MAX_BYTES) localStorage.setItem(KEY, raw);
  } catch { /* private mode or full storage: the feed simply loads as before */ }
}

export function clearSavedFeedPage(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
