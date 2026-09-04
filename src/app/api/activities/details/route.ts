/**
 * GET /api/activities/details?activityId=<uuid|legacy numeric>[&athleteId=]
 *
 * Returns route/splits and the activity's own summary row from what we already
 * stored at Strava sync time. No live Garmin call — Strava is the only activity
 * source.
 *
 * `athleteId` is optional. A caller arriving from a feed card has the activity's
 * uuid and nothing else; when it IS supplied it narrows the lookup, which is how
 * a legacy numeric garmin/strava id gets disambiguated between athletes.
 *
 * ⚠️ Exposure change (deliberate, 2026-09-03): this used to be self-or-staff.
 * It is now any verified club member — tapping a teammate's run in the feed
 * shows the same detail the runner sees. The response is the full GPS trace of a
 * run: where someone lives and when they were out. That is club-visible now by
 * product decision, so it stays behind `requireMember` (logged in AND has an
 * athletes/coaches row) and must never become public.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/** Everything the detail UI shows above the charts. */
const SUMMARY_COLS = `
  id, athlete_id, source, strava_activity_id, garmin_activity_id,
  activity_name, activity_type, start_time,
  distance, duration, moving_duration, average_pace, average_hr, max_hr,
  calories, elevation_gain, start_lat, start_lng,
  avg_cadence, avg_stride_length, vo2max, lap_count, location_name,
  perceived_rpe, perceived_feel,
  gps_points, laps, splits, has_polyline,
  athletes (name)`;

/** Same, plus the shoe attribution from migration 075 (may be unapplied). */
const SUMMARY_COLS_WITH_SHOE = `${SUMMARY_COLS}, shoes (name)`;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get('activityId');
    const athleteId = searchParams.get('athleteId');

    if (!activityId) {
      return NextResponse.json({ error: 'activityId required' }, { status: 400 });
    }

    const denied = await requireMember(request);
    if (denied) return denied;

    const supabase = createServerClient();

    // Prefer DB uuid; also accept legacy garmin_activity_id / strava_activity_id.
    const isUuid = /^[0-9a-f-]{36}$/i.test(activityId);
    const runQuery = (cols: string) => {
      let q = supabase.from('athlete_activities').select(cols);
      if (athleteId) q = q.eq('athlete_id', athleteId);
      if (isUuid) q = q.eq('id', activityId);
      else {
        const n = Number(activityId);
        q = q.or(`strava_activity_id.eq.${Math.abs(n)},garmin_activity_id.eq.${n}`);
      }
      return q.maybeSingle();
    };

    let { data: row, error } = await runQuery(SUMMARY_COLS_WITH_SHOE);
    if (error) {
      // Pre-075 database: no shoe_id column, so the embed can't resolve.
      ({ data: row, error } = await runQuery(SUMMARY_COLS));
    }
    if (error) throw error;
    if (!row) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const r = row as any;
    const laps = (r.laps as any[]) || [];
    const splits =
      (r.splits as any[]) ||
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

    // The summary row, shaped like the list endpoint's rows so the detail UI can
    // take either one. `gps_points`/`laps`/`splits` are dropped from it — they're
    // already the top-level `gpsPoints`/`splits`, and repeating a 60KB trace
    // doubles the response.
    const { gps_points, laps: _laps, splits: _splits, athletes, shoes, ...rest } = r;
    const activity = {
      ...rest,
      athlete_name: athletes?.name || 'Unknown',
      shoe_name: shoes?.name ?? null,
    };

    return NextResponse.json({
      gpsPoints: gps_points || [],
      splits,
      hasPolyline: !!r.has_polyline,
      source: r.source || 'strava',
      activity,
    });
  } catch (error: any) {
    console.error('Activity details error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
