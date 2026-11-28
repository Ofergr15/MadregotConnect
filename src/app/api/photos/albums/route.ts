/**
 * GET /api/photos/albums?by=week|event&cursor=&limit= — the photo gallery's albums (task 183):
 * the club's Drive photo folders grouped per club week (plan week, Sunday) or per event, newest
 * first, keyset-paged. Each album carries up to three signed thumbnail covers (our mirrored copy
 * where there is one, else a signed Drive link — both expire). Any verified member.
 *
 * → { configured, by, albums: [{ key, kind, title, from, to, count, folderIds, covers, eventId? }], nextCursor }
 * Open an album with /api/photos/albums/photos?key=<key>.
 */
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { THUMB, listPhotoFolders, signedImageUrl } from '@/lib/photos/drive-browse';
import { mirroredUrls } from '@/lib/photos/mirror';
import {
  ALBUMS_PAGE_DEFAULT, ALBUMS_PAGE_MAX, clampLimit, eventAlbums, pageAlbums, weekAlbums, type ClubEvent,
} from '@/lib/photos/albums';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIVATE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const by = searchParams.get('by') || 'week';
  if (by !== 'week' && by !== 'event') return NextResponse.json({ error: 'by must be week or event' }, { status: 400 });
  const limit = clampLimit(searchParams.get('limit'), ALBUMS_PAGE_DEFAULT, ALBUMS_PAGE_MAX);
  try {
    const folders = await listPhotoFolders();
    if (!folders) return NextResponse.json({ configured: false, by, albums: [], nextCursor: null }, { headers: PRIVATE });

    let albums;
    if (by === 'week') {
      albums = weekAlbums(folders);
    } else {
      const dates = folders.map((f) => f.date).filter(Boolean).sort();
      let events: ClubEvent[] = [];
      if (dates.length) {
        const { data, error } = await createServerClient().from('events').select('id, name, date, end_date')
          .lte('date', dates[dates.length - 1]).or(`end_date.gte.${dates[0]},and(end_date.is.null,date.gte.${dates[0]})`)
          .order('date', { ascending: false }).limit(1000);
        if (error) throw new Error(error.message);
        events = (data || []) as ClubEvent[];
      }
      albums = eventAlbums(folders, events);
    }

    const page = pageAlbums(albums, searchParams.get('cursor'), limit);
    const m = await mirroredUrls(page.albums.flatMap((a) => a.coverIds));
    return NextResponse.json({
      configured: true,
      by,
      albums: page.albums.map(({ coverIds, ...a }) => ({
        ...a,
        covers: coverIds.map((id) => m.thumb[id] ?? signedImageUrl(id, THUMB)).filter(Boolean),
        coverBlur: coverIds[0] ? m.lqip[coverIds[0]] ?? null : null,
      })),
      nextCursor: page.nextCursor,
    }, { headers: PRIVATE });
  } catch (error) {
    console.error('photos albums failed:', error);
    return NextResponse.json({ error: 'Failed to load albums' }, { status: 500 });
  }
}
