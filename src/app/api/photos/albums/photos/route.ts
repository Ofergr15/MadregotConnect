/**
 * GET /api/photos/albums/photos?key=week:YYYY-MM-DD|event:<id>&offset=&limit= — one album's
 * photos (task 183), across all its Drive folders, in the order they were shot, offset-paged.
 * Each photo: signed thumbnail + full-size link (mirrored copy first, else signed Drive link),
 * its blurred stand-in, its size. Any verified member.
 *
 * → { album: { key, kind, title, from, to, count }, photos: [{ id, folderId, w, h, t, thumb, full, blur }], nextOffset }
 */
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { FULL, THUMB, listFolderPhotos, listPhotoFolders, signedImageUrl } from '@/lib/photos/drive-browse';
import { mirroredUrls } from '@/lib/photos/mirror';
import { exifToIso } from '@/lib/photos/video-time';
import {
  ALBUM_PHOTOS_PAGE_DEFAULT, ALBUM_PHOTOS_PAGE_MAX, clampLimit, eventAlbums, pageOffset, parseAlbumKey, weekAlbums,
  type ClubEvent,
} from '@/lib/photos/albums';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIVATE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const key = parseAlbumKey(searchParams.get('key'));
  if (!key) return NextResponse.json({ error: 'invalid album key' }, { status: 400 });
  const limit = clampLimit(searchParams.get('limit'), ALBUM_PHOTOS_PAGE_DEFAULT, ALBUM_PHOTOS_PAGE_MAX);
  try {
    const folders = await listPhotoFolders();
    if (!folders) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let album;
    if (key.kind === 'week') {
      album = weekAlbums(folders).find((a) => a.key === `week:${key.value}`);
    } else {
      const { data, error } = await createServerClient().from('events').select('id, name, date, end_date').eq('id', key.value).maybeSingle();
      if (error && !/invalid input syntax/i.test(error.message)) throw new Error(error.message);
      album = data ? eventAlbums(folders, [data as ClubEvent])[0] : undefined;
    }
    if (!album) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const listed = await Promise.all(album.folderIds.map(async (id) => [id, await listFolderPhotos(id)] as const));
    const all = listed.flatMap(([folderId, res]) => (res?.photos ?? []).map((p) => ({ ...p, folderId, t: exifToIso(p.at) })))
      // Shot order; a photo with no time goes after its folder's timed ones, by id for stability.
      .sort((a, b) => (a.t && b.t ? a.t.localeCompare(b.t) : a.t ? -1 : b.t ? 1 : 0) || a.id.localeCompare(b.id));
    const page = pageOffset(all, searchParams.get('offset'), limit);
    const m = await mirroredUrls(page.items.map((p) => p.id));
    const { coverIds: _c, folderIds: _f, ...meta } = album;
    return NextResponse.json({
      album: meta,
      photos: page.items.map((p) => ({
        id: p.id, folderId: p.folderId, w: p.w, h: p.h, t: p.t,
        thumb: m.thumb[p.id] ?? signedImageUrl(p.id, THUMB),
        full: m.full[p.id] ?? signedImageUrl(p.id, FULL),
        blur: m.lqip[p.id] ?? null,
      })),
      nextOffset: page.nextOffset,
    }, { headers: PRIVATE });
  } catch (error) {
    console.error('photos album photos failed:', error);
    return NextResponse.json({ error: 'Failed to load the album' }, { status: 500 });
  }
}
