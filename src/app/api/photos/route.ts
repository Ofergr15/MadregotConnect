/**
 * GET /api/photos?date=YYYY-MM-DD    — any athlete: browse all photos for a run date
 * GET /api/photos?importedDates=1    — any athlete: list of dates with imported photos
 * GET /api/photos?athleteId=<uuid>   — athletes get own; staff can get any
 *
 * Returns photos with their detected faces joined. The `date` branch omits
 * tagged athletes' emails from the join — unlike the staff-only branches
 * below, any club member can hit this one, and email was never shown by
 * the Browse tab's UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const rawAthleteId = searchParams.get('athleteId');
    const importedDates = searchParams.get('importedDates');
    const folderId = searchParams.get('folderId');

    const supabase = createServerClient();

    // Return list of distinct run_dates that have been imported
    if (importedDates) {
      const { data, error } = await supabase
        .from('run_photos')
        .select('run_date')
        .order('run_date', { ascending: false });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const dates = [...new Set((data ?? []).map(r => r.run_date))];
      return NextResponse.json({ dates });
    }

    // Photos for a specific Drive folder (Import tab preview)
    if (folderId) {
      if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const { data, error } = await supabase
        .from('run_photos')
        .select('id, thumbnail_url, drive_url, filename, processed_at, faces_detected')
        .eq('drive_folder_id', folderId)
        .order('taken_at', { ascending: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ photos: data });
    }

    if (date) {
      // Date-based — any club member can browse (Browse tab); tagged
      // athletes' emails are deliberately excluded from this select.
      const { data, error } = await supabase
        .from('run_photos')
        .select(`
          id, drive_url, thumbnail_url, filename, run_date, taken_at,
          faces_detected, processed_at,
          detected_faces (
            id, bounding_box, crop_url, athlete_id, confidence, source,
            athletes ( id, name )
          )
        `)
        .eq('run_date', date)
        .order('taken_at', { ascending: true });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ photos: data });
    }

    if (rawAthleteId !== null) {
      // Athletes are forced to their own id; staff can request any
      const resolvedId = isStaff(user.role) ? rawAthleteId : user.athleteId;

      const { data, error } = await supabase
        .from('detected_faces')
        .select(`
          id, crop_url, confidence, source,
          run_photos (
            id, drive_url, thumbnail_url, run_date, taken_at
          )
        `)
        .eq('athlete_id', resolvedId)
        .order('created_at', { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ faces: data });
    }

    // No filter — staff gets unidentified faces grouped by cluster
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: 'athleteId param required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('detected_faces')
      .select(`
        id, cluster_id, crop_url, person_name,
        run_photos ( id, run_date )
      `)
      .is('athlete_id', null)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Group into clusters (null cluster_id = one card per face)
    const clusterMap = new Map<string, {
      clusterId: string;
      faces: Array<{ id: string; crop_url: string | null; run_date: string | null }>;
      personName: string | null;
    }>();

    for (const face of data ?? []) {
      const key = face.cluster_id ?? face.id;
      if (!clusterMap.has(key)) {
        clusterMap.set(key, { clusterId: key, faces: [], personName: face.person_name ?? null });
      }
      const rp = face.run_photos as { run_date?: string } | null;
      clusterMap.get(key)!.faces.push({
        id: face.id,
        crop_url: face.crop_url ?? null,
        run_date: rp?.run_date ?? null,
      });
    }

    const clusters = Array.from(clusterMap.values()).map(c => ({
      ...c,
      runDates: [...new Set(c.faces.map(f => f.run_date).filter(Boolean))].sort(),
    }));

    return NextResponse.json({ clusters });
  } catch (error: unknown) {
    console.error('GET /api/photos error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
