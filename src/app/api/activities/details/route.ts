/**
 * GET /api/activities/details?activityId=<uuid|&athleteId=
 *
 * Returns route/splits from what we already stored at Strava sync time.
 * No live Garmin call — Strava is the only activity source.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get('activityId');
    const athleteId = searchParams.get('athleteId');

    if (!activityId || !athleteId) {
      return NextResponse.json({ error: 'activityId and athleteId required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { data: caller } = await supabase
      .from('athletes')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();
    const isStaff = !!caller && ['coach', 'admin', 'academy_coach'].includes(caller.role as string);
    if (!caller || (!isStaff && caller.id !== athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Prefer DB uuid; also accept legacy garmin_activity_id / strava_activity_id.
    const isUuid = /^[0-9a-f-]{36}$/i.test(activityId);
    let q = supabase
      .from('athlete_activities')
      .select(
        'id, athlete_id, source, strava_activity_id, garmin_activity_id, gps_points, laps, splits, has_polyline, average_hr, max_hr, distance, duration',
      )
      .eq('athlete_id', athleteId);

    if (isUuid) q = q.eq('id', activityId);
    else {
      const n = Number(activityId);
      q = q.or(`strava_activity_id.eq.${Math.abs(n)},garmin_activity_id.eq.${n}`);
    }

    const { data: row, error } = await q.maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const laps = (row.laps as any[]) || [];
    const splits =
      (row.splits as any[]) ||
      laps.map((lap, i) => ({
        distance: lap.distance || 0,
        duration: lap.moving_time || lap.elapsed_time || 0,
        averagePace:
          lap.distance > 0
            ? Math.round((lap.moving_time || lap.elapsed_time || 0) / (lap.distance / 1000))
            : 0,
        averageHR: lap.average_heartrate || null,
        maxHR: lap.max_heartrate || null,
        elevationGain: null,
        elevationLoss: null,
        cadence: null,
        strideLength: null,
        name: lap.name || `Lap ${i + 1}`,
      }));

    return NextResponse.json({
      gpsPoints: row.gps_points || [],
      splits,
      hasPolyline: !!row.has_polyline,
      source: row.source || 'strava',
    });
  } catch (error: any) {
    console.error('Activity details error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
