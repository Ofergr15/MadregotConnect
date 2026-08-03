/**
 * POST /api/photos/import
 * Body: { date: "YYYY-MM-DD" }
 *
 * Imports all photos from Drive for the given date. Inserts run_photos rows
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
    const { date } = body as { date?: string };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 });
    }

    const photos = await listPhotos(date);
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

    // Upsert — idempotent on drive_file_id
    const rows = photos.map(p => ({
      drive_file_id: p.id,
      drive_url: p.webViewLink,
      thumbnail_url: p.thumbnailLink ?? null,
      filename: p.name,
      taken_at: p.createdTime,
      run_date: date,
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
      .eq('run_date', date)
      .is('processed_at', null);

    const photoIds = (unprocessed ?? []).map(r => r.id);
    return NextResponse.json({ imported: photos.length, photoIds });
  } catch (error: unknown) {
    console.error('POST /api/photos/import error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
