/**
 * GET /api/activities?athleteId=&include=gps
 *
 * Lists athlete_activities for the feed. Staff (coach/admin/academy_coach)
 * may omit athleteId for the club roster; runners must pass their own id.
 *
 * `gps_points` (full per-run GPS trace, ~30-60KB/row) is excluded by default —
 * most callers only need distance/duration/pace/has_polyline and fetch the
 * route lazily per-card via /api/activities/details. Pass `include=gps` to
 * get it inline for consumers (e.g. the activities feed) that render the
 * route straight from the list without a follow-up fetch.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const includeGps = searchParams.get('include') === 'gps';

    let isStaff = false;
    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    if (email) {
      const { data: me } = await supabase
        .from('athletes')
        .select('role')
        .eq('email', email)
        .in('role', ['coach', 'admin', 'academy_coach'])
        .maybeSingle();
      isStaff = !!me;
    }

    if (!isStaff && !athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    const baseCols = `
        id, athlete_id, garmin_activity_id, strava_activity_id, source,
        activity_name, activity_type,
        start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr,
        calories, elevation_gain, start_lat, start_lng, end_lat, end_lng,
        avg_cadence, avg_stride_length, vo2max, lap_count, location_name,
        has_polyline, splits, laps, created_at,
        athletes (name)`;

    const runQuery = (cols: string) => {
      let q = supabase
        .from('athlete_activities')
        .select(cols)
        .order('start_time', { ascending: false })
        .limit(200);
      if (!isStaff && athleteId) q = q.eq('athlete_id', athleteId);
      return q;
    };

    let activities: any[] | null = null;
    let error: any = null;
    if (includeGps) {
      // gps_points is a large JSONB blob; only select it when a caller
      // explicitly asks for it. Fall back to the lean columns if the
      // combined select errors out for any reason.
      ({ data: activities, error } = await runQuery(`${baseCols}, gps_points`));
      if (error) {
        ({ data: activities, error } = await runQuery(baseCols));
      }
    } else {
      ({ data: activities, error } = await runQuery(baseCols));
    }
    if (error) throw error;

    const enriched = (activities || []).map((a: any) => ({
      ...a,
      athlete_name: a.athletes?.name || 'Unknown',
      athletes: undefined,
    }));

    return NextResponse.json({ activities: enriched });
  } catch (error: any) {
    console.error('Fetch activities error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
