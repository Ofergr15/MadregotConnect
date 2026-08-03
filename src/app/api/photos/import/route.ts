/**
 * POST /api/photos/import
 * Body: { folderId: string, folderName: string }
 *
 * Imports all photos from a Drive run subfolder. Inserts run_photos rows
 * (idempotent on drive_file_id). Does NO face detection — that's /process.
 * Returns the list of photoIds that still need processing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { listPhotos } from '@/lib/google-drive/client';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const { folderId, folderName } = body as { folderId?: string; folderName?: string };
    if (!folderId) {
      return NextResponse.json({ error: 'folderId is required' }, { status: 400 });
    }

    const photos = await listPhotos(folderId);
    if (photos.length === 0) {
      return NextResponse.json({ imported: 0, photoIds: [] });
    }

    const supabase = createServerClient();

    // Look up the coach_id for this user
    const { data: athlete } = await supabase
      .from('athletes')
      .select('coach_id')
      .eq('id', user.athleteId)
      .maybeSingle();
    const coachId = athlete?.coach_id ?? null;

    // Use the folder's first photo date as run_date, or today as fallback
    const runDate = (photos[0]?.createdTime ?? new Date().toISOString()).slice(0, 10);

    // Upsert — idempotent on drive_file_id
    const rows = photos.map(p => ({
      drive_file_id: p.id,
      drive_url: p.webViewLink,
      thumbnail_url: p.thumbnailLink ?? null,
      filename: p.name,
      taken_at: p.createdTime,
      run_date: runDate,
      width: p.imageMediaMetadata?.width ?? null,
      height: p.imageMediaMetadata?.height ?? null,
      coach_id: coachId,
    }));

    const { error } = await supabase
      .from('run_photos')
      .upsert(rows, { onConflict: 'drive_file_id', ignoreDuplicates: false });

    if (error) {
      return NextResponse.json({ error: 'DB upsert failed', details: error.message }, { status: 500 });
    }

    // Return IDs of photos that still need processing (no processed_at)
    const { data: unprocessed } = await supabase
      .from('run_photos')
      .select('id')
      .eq('run_date', runDate)
      .in('drive_file_id', photos.map(p => p.id))
      .is('processed_at', null);

    const photoIds = (unprocessed ?? []).map(r => r.id);
    return NextResponse.json({ imported: photos.length, photoIds, runDate, folderName: folderName ?? folderId });
  } catch (error: unknown) {
    console.error('POST /api/photos/import error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
