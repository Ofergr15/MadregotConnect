import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { listFolderPhotos } from '@/lib/photos/drive-browse';
import { tagsGate } from '@/lib/photos/tags-gate';
import { initialStatus, isDriveId, mayRemove, missingTable, namesFor, project, type PhotoTagRow } from '@/lib/photos/tags';

export const dynamic = 'force-dynamic';

/**
 * Manual photo tags (migration 214, flag `photo_tags`). Members only — a tag is never readable outside the
 * club. No face recognition.
 *
 * GET    ?folderId=…                → { tags: PublicTag[] } for one album (approved + the caller's own pending)
 * POST   { photoId, folderId, athleteId } → { tag }  self = approved, someone else = pending until they approve
 * DELETE { photoId, athleteId }     → { ok }  the tagged person, the tagger while pending, or staff
 */
export async function GET(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const folderId = new URL(request.url).searchParams.get('folderId');
  if (!isDriveId(folderId)) return NextResponse.json({ error: 'folderId required' }, { status: 400 });
  try {
    const db = createServerClient();
    const { data, error } = await db.from('photo_tags').select('*').eq('folder_id', folderId);
    if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
    if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
    const rows = (data || []) as PhotoTagRow[];
    return NextResponse.json({ tags: project(g.actor, rows, await namesFor(db, rows.map((r) => r.athlete_id))) });
  } catch (err) {
    console.error('[api/photos/tags GET]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const photoId = b?.photoId, folderId = b?.folderId, athleteId = b?.athleteId;
  if (!isDriveId(photoId) || !isDriveId(folderId) || typeof athleteId !== 'string' || !athleteId) {
    return NextResponse.json({ error: 'photoId, folderId, athleteId required' }, { status: 400 });
  }
  try {
    // The photo must be in that album of the session-photos library (the stored listing — no Drive call).
    const album = await listFolderPhotos(folderId);
    if (!album || !album.photos.some((p) => p.id === photoId)) return NextResponse.json({ error: 'photo not found' }, { status: 404 });
    const db = createServerClient();
    const { data: who } = await db.from('athletes').select('id, status').eq('id', athleteId).maybeSingle<{ id: string; status: string | null }>();
    if (!who || who.status === 'removed') return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
    const status = initialStatus(g.actor, athleteId);
    const row = {
      photo_id: photoId, folder_id: folderId, athlete_id: athleteId, tagged_by: g.actor.athleteId, status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
    };
    // An existing tag is kept as it is (never downgraded from approved, never re-attributed).
    const { data, error } = await db.from('photo_tags').upsert(row, { onConflict: 'photo_id,athlete_id', ignoreDuplicates: true }).select('*');
    if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
    if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
    let saved = (data as PhotoTagRow[] | null)?.[0];
    if (!saved) {
      const { data: existing } = await db.from('photo_tags').select('*').eq('photo_id', photoId).eq('athlete_id', athleteId).maybeSingle<PhotoTagRow>();
      saved = existing ?? undefined;
    }
    if (!saved) return NextResponse.json({ error: 'failed' }, { status: 500 });
    const [tag] = project(g.actor, [saved], await namesFor(db, [athleteId]));
    return NextResponse.json({ tag: tag ?? null });
  } catch (err) {
    console.error('[api/photos/tags POST]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const photoId = b?.photoId, athleteId = b?.athleteId;
  if (!isDriveId(photoId) || typeof athleteId !== 'string' || !athleteId) {
    return NextResponse.json({ error: 'photoId, athleteId required' }, { status: 400 });
  }
  try {
    const db = createServerClient();
    const { data: tag, error } = await db.from('photo_tags').select('*').eq('photo_id', photoId).eq('athlete_id', athleteId).maybeSingle<PhotoTagRow>();
    if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
    if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
    if (!tag) return NextResponse.json({ ok: true });
    if (!mayRemove(g.actor, tag)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const del = await db.from('photo_tags').delete().eq('id', tag.id);
    if (del.error) return NextResponse.json({ error: 'failed', details: del.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/photos/tags DELETE]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
