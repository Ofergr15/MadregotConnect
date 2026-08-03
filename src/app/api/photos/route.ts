/**
 * GET /api/photos?date=YYYY-MM-DD    — staff only: photos for a run date
 * GET /api/photos?athleteId=<uuid>   — athletes get own; staff can get any
 *
 * Returns photos with their detected faces joined.
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

    const supabase = createServerClient();

    if (date) {
      // Date-based — staff only
      if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const { data, error } = await supabase
        .from('run_photos')
        .select(`
          id, drive_url, thumbnail_url, filename, run_date, taken_at,
          faces_detected, processed_at,
          detected_faces (
            id, bounding_box, crop_url, athlete_id, confidence, source,
            athletes ( id, name, email )
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

    // No filter — staff gets all unidentified faces (for the Unknown faces tab)
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: 'athleteId param required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('detected_faces')
      .select(`
        id, crop_url, bounding_box,
        run_photos ( id, drive_url, thumbnail_url, run_date )
      `)
      .is('athlete_id', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ unidentified: data });
  } catch (error: unknown) {
    console.error('GET /api/photos error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
