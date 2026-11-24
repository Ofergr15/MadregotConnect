import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { listFolderPhotos } from '@/lib/photos/drive-browse';
import { tagsGate } from '@/lib/photos/tags-gate';
import { isDriveId, likeCounts, missingTable } from '@/lib/photos/tags';

export const dynamic = 'force-dynamic';

/**
 * Likes on library photos and videos ("אהבתי", migration 214, flag `photos_social`). Members only.
 *
 * GET    ?folderId=…            → { likes: { [mediaId]: { count, mine } } } — counts only, never who
 * POST   { mediaId, folderId }  → { ok }  idempotent
 * DELETE { mediaId }            → { ok }  removes the caller's own like only
 */
export async function GET(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const folderId = new URL(request.url).searchParams.get('folderId');
  if (!isDriveId(folderId)) return NextResponse.json({ error: 'folderId required' }, { status: 400 });
  const { data, error } = await createServerClient().from('photo_likes').select('media_id, athlete_id').eq('folder_id', folderId);
  if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
  if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
  return NextResponse.json({ likes: likeCounts((data || []) as Array<{ media_id: string; athlete_id: string }>, g.actor.athleteId) });
}

export async function POST(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isDriveId(b?.mediaId) || !isDriveId(b?.folderId)) return NextResponse.json({ error: 'mediaId, folderId required' }, { status: 400 });
  const mediaId = b!.mediaId as string, folderId = b!.folderId as string;
  const album = await listFolderPhotos(folderId).catch(() => null);
  const kind = album?.photos.some((p) => p.id === mediaId) ? 'photo' : album?.videos.some((v) => v.id === mediaId) ? 'video' : null;
  if (!kind) return NextResponse.json({ error: 'media not found' }, { status: 404 });
  const { error } = await createServerClient().from('photo_likes')
    .upsert({ media_id: mediaId, folder_id: folderId, kind, athlete_id: g.actor.athleteId }, { onConflict: 'media_id,athlete_id', ignoreDuplicates: true });
  if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
  if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isDriveId(b?.mediaId)) return NextResponse.json({ error: 'mediaId required' }, { status: 400 });
  const { error } = await createServerClient().from('photo_likes').delete().eq('media_id', b!.mediaId as string).eq('athlete_id', g.actor.athleteId);
  if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
  if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
