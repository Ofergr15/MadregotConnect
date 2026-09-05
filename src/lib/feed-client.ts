'use client';

import { getSupabase } from '@/lib/supabase/client';
import { trySilentReauth } from '@/lib/auth/silent-reauth';
import type { FeedItem, FeedLiker, FeedMedia } from '@/lib/feed/project';

/**
 * Client helpers for the feed API.
 *
 * Unlike the rest of the app — which sends a forgeable `x-user-email` header — these
 * attach the real Supabase session JWT. The server derives the acting athlete from
 * that token, so a comment can only ever be posted as the signed-in member.
 */

export interface FeedComment {
  id: string;
  itemId: string;
  body: string;
  createdAt: string;
  author: { athleteId: string; name: string; avatarUrl: string | null };
  canDelete: boolean;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token || (await trySilentReauth());
  if (!token) throw new Error('NOT_SIGNED_IN');
  return { ...extra, Authorization: `Bearer ${token}` };
}

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  return json as T;
}

/**
 * One page of the club feed. `types` narrows it to a subset of feed_item types
 * (the filter chips on the feed, the Profile screen's announcements deck) — the
 * filter has to be applied server-side, or a page of 20 that happens to be all
 * runs comes back empty after client-side filtering.
 */
export async function fetchFeed(cursor?: string | null, limit = 15, types?: readonly string[]) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  if (types && types.length > 0) qs.set('types', types.join(','));
  const res = await fetch(`/api/feed?${qs}`, { headers: await authHeaders() });
  return parse<{ items: FeedItem[]; nextCursor: string | null }>(res);
}

export async function toggleLike(itemId: string) {
  const res = await fetch('/api/feed/like', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ itemId }),
  });
  return parse<{ liked: boolean; likeCount: number; likePreview: FeedLiker[] }>(res);
}

/** Everyone who liked an item, newest first — backs the like sheet. */
export async function fetchLikers(itemId: string) {
  const res = await fetch(`/api/feed/likes?itemId=${encodeURIComponent(itemId)}`, {
    headers: await authHeaders(),
  });
  return parse<{ likers: FeedLiker[] }>(res);
}

export async function fetchComments(itemId: string) {
  const res = await fetch(`/api/feed/comments?itemId=${encodeURIComponent(itemId)}`, {
    headers: await authHeaders(),
  });
  return parse<{ comments: FeedComment[] }>(res);
}

export async function addComment(itemId: string, body: string) {
  const res = await fetch('/api/feed/comments', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ itemId, body }),
  });
  return parse<{ comment: FeedComment; commentCount: number }>(res);
}

export async function deleteComment(id: string) {
  const res = await fetch(`/api/feed/comments?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  return parse<{ success: true; commentCount: number }>(res);
}

export async function createPost(body: string, media: FeedMedia[]) {
  const res = await fetch('/api/feed/posts', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ body, media }),
  });
  return parse<{ item: FeedItem }>(res);
}

export async function deletePost(id: string) {
  const res = await fetch(`/api/feed/posts?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  return parse<{ success: true }>(res);
}

/**
 * Look up the feed_item auto-created for a given activity (see
 * trg_feed_item_for_activity, migration 047). Used right after a Garmin/Strava
 * sync, when the caller has the new activity's id but not yet the feed_item
 * id it was matched to.
 */
export async function fetchFeedItemByActivity(activityId: string) {
  const res = await fetch(`/api/feed/items/${encodeURIComponent(activityId)}?by=activity`, {
    headers: await authHeaders(),
  });
  return parse<{ item: FeedItem }>(res);
}

export type FeedHiddenField = 'calories' | 'heart_rate' | 'pace' | 'power';

export interface UpdateFeedItemInput {
  body?: string;
  visibility?: 'club' | 'group' | 'private';
  media?: FeedMedia[];
  hiddenFields?: FeedHiddenField[];
  tag?: string | null;
  /** Renames the underlying activity itself (athlete_activities.activity_name). */
  activityName?: string;
}

/** PATCH an existing feed_item — caption, audience, media, tag, hidden stats, or the activity's own name. */
export async function updateFeedItem(id: string, patch: UpdateFeedItemInput) {
  const res = await fetch(`/api/feed/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  return parse<{ item: FeedItem }>(res);
}

/**
 * Downscale an image in the browser before upload. Phone photos are 3–8MB; sending
 * them raw is slow on mobile data and wasteful in Storage. Long edge 1600px at q0.82
 * is indistinguishable in a feed card.
 *
 * Falls back to the original file if anything about the canvas path fails (e.g. a HEIC
 * the browser can't decode) — the server accepts both.
 */
async function downscale(file: File, maxEdge = 1600, quality = 0.82): Promise<{ blob: Blob; w: number | null; h: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, w: bitmap.width, h: bitmap.height };
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );
    return blob ? { blob, w, h } : { blob: file, w, h };
  } catch {
    return { blob: file, w: null, h: null };
  }
}

export async function uploadMedia(file: File): Promise<FeedMedia> {
  const { blob, w, h } = await downscale(file);
  const form = new FormData();
  form.append('file', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));
  if (w) form.append('w', String(w));
  if (h) form.append('h', String(h));

  // No Content-Type header — the browser must set the multipart boundary.
  const res = await fetch('/api/feed/media', {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  const { media } = await parse<{ media: FeedMedia }>(res);
  return media;
}

export type { FeedItem, FeedLiker, FeedMedia };
