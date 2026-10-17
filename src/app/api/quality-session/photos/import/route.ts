import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isStoryEditor } from '@/lib/quality-session/access';
import { MAX_SESSION_PHOTOS } from '@/lib/quality-session/photos';
import {
  ALBUM_HOSTS, IMAGE_HOSTS, driveFolderGridUrl, driveFolderImages, googlePhotosImages,
  isAllowedHost, parseAlbumLink,
} from '@/lib/quality-session/album-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

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

// POST /api/quality-session/photos/import { link } -> { media, found } | { error }
//   Reads the album the link points at (lib/quality-session/album-import.ts), takes
//   the first photos, shrinks each to 1600 px JPEG and files it in feed-media under
//   the caller's id — so publishing goes through the same ownership check as a
//   photo picked from the phone, and the feed never depends on Drive afterwards.
//   Errors: 'unsupported' (not a Drive folder / Photos album: keep it as a link),
//   'not-shared' (Google wants a login), 'no-photos'.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const supabase = createServerClient();
  if (!auth.user.athleteId || (!auth.user.isSuperUser && !(await isStoryEditor(supabase, auth.user.athleteId)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const want = Math.min(Math.max(Number(body?.max) || MAX_SESSION_PHOTOS, 1), MAX_SESSION_PHOTOS);
  const album = typeof body?.link === 'string' ? parseAlbumLink(body.link.trim()) : null;
  if (!album) return NextResponse.json({ error: 'unsupported' }, { status: 400 });

  try {
    const page = await googleGet(album.kind === 'drive' ? driveFolderGridUrl(album.folderId) : album.url, ALBUM_HOSTS);
    if (!page || !page.ok) return NextResponse.json({ error: 'not-shared' }, { status: 422 });
    const html = await page.text();
    const candidates = album.kind === 'drive' ? driveFolderImages(html) : googlePhotosImages(html);
    // A login wall answers 200 with Google's sign-in page and no photos in it.
    if (candidates.length === 0) {
      return NextResponse.json({ error: /accounts\.google\.com|ServiceLogin/.test(html) ? 'not-shared' : 'no-photos' }, { status: 422 });
    }

    const media: Array<{ path: string; url: string; w: number | null; h: number | null }> = [];
    for (const src of candidates) {
      if (media.length >= want) break;
      try {
        const res = await googleGet(src, IMAGE_HOSTS, 15_000);
        if (!res?.ok || !(res.headers.get('content-type') || '').startsWith('image/')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_IMAGE_BYTES) continue;
        // .rotate() applies the EXIF orientation, so a portrait phone photo stays upright.
        const { data, info } = await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
        const path = `${auth.user.athleteId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from('feed-media').upload(path, data, { contentType: 'image/jpeg', upsert: false });
        if (error) continue;
        media.push({ path, url: supabase.storage.from('feed-media').getPublicUrl(path).data.publicUrl, w: info.width, h: info.height });
      } catch { /* one unreadable file must not stop the rest */ }
    }
    if (media.length === 0) return NextResponse.json({ error: 'no-photos' }, { status: 422 });
    return NextResponse.json({ media, found: candidates.length });
  } catch (err) {
    console.error('[quality-session/photos/import] failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
