import sharp from 'sharp';
import type { createServerClient } from '@/lib/supabase/server';
import {
  ALBUM_HOSTS, IMAGE_HOSTS, driveFolderGridUrl, driveFolderImages, googlePhotosImages,
  isAllowedHost, parseAlbumLink,
} from './album-import';

// Fetching an album's photos — the server half of album-import.ts, shared by the
// screen's "paste a link" (POST /api/quality-session/photos/import) and the
// automatic folder of the morning (auto-photos.ts).

type Db = ReturnType<typeof createServerClient>;

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export interface PulledMedia { path: string; url: string; w: number | null; h: number | null }
export type AlbumResult =
  | { ok: true; media: PulledMedia[]; found: number }
  | { ok: false; error: 'unsupported' | 'not-shared' | 'no-photos' };

/** A GET that only ever talks to the allowed Google hosts, redirects included. */
async function googleGet(url: string, hosts: string[], ms = 12_000): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!isAllowedHost(current, hosts)) return null;
    const res = await fetch(current, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(ms) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return null;
      current = new URL(next, current).toString();
      continue;
    }
    return res;
  }
  return null;
}

/** The photo URLs in the album, without downloading any of them. */
export async function albumPhotoUrls(link: string): Promise<{ ok: true; urls: string[] } | { ok: false; error: 'unsupported' | 'not-shared' | 'no-photos' }> {
  const album = parseAlbumLink(link.trim());
  if (!album) return { ok: false, error: 'unsupported' };
  const page = await googleGet(album.kind === 'drive' ? driveFolderGridUrl(album.folderId) : album.url, ALBUM_HOSTS);
  if (!page || !page.ok) return { ok: false, error: 'not-shared' };
  const html = await page.text();
  const urls = album.kind === 'drive' ? driveFolderImages(html, 100) : googlePhotosImages(html, 100);
  // A login wall answers 200 with Google's sign-in page and no photos in it.
  if (urls.length === 0) return { ok: false, error: /accounts\.google\.com|ServiceLogin/.test(html) ? 'not-shared' : 'no-photos' };
  return { ok: true, urls };
}

/**
 * The album's first `max` photos (after `skip`), each shrunk to 1600 px JPEG and
 * filed in feed-media under `prefix` — so the feed never depends on Drive later.
 */
export async function pullAlbumPhotos(
  supabase: Db,
  link: string,
  opts: { prefix: string; max: number; skip?: number },
): Promise<AlbumResult> {
  const list = await albumPhotoUrls(link);
  if (!list.ok) return list;
  const media: PulledMedia[] = [];
  for (const src of list.urls.slice(opts.skip ?? 0)) {
    if (media.length >= opts.max) break;
    try {
      const res = await googleGet(src, IMAGE_HOSTS, 15_000);
      if (!res?.ok || !(res.headers.get('content-type') || '').startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) continue;
      // .rotate() applies the EXIF orientation, so a portrait phone photo stays upright.
      const { data, info } = await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
      const path = `${opts.prefix}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from('feed-media').upload(path, data, { contentType: 'image/jpeg', upsert: false });
      if (error) continue;
      media.push({ path, url: supabase.storage.from('feed-media').getPublicUrl(path).data.publicUrl, w: info.width, h: info.height });
    } catch { /* one unreadable file must not stop the rest */ }
  }
  if (media.length === 0) return { ok: false, error: 'no-photos' };
  return { ok: true, media, found: list.urls.length };
}
