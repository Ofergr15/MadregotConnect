/**
 * GET /api/activities/details?activityId=<uuid|legacy numeric>[&athleteId=]
 *
 * Returns route/splits and the activity's own summary row from what the sync
 * already stored. No live provider call — and both providers fill these columns,
 * Garmin for most of the club and Strava for the rest, which is why the splits
 * are read through one normaliser rather than one provider's key names.
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
import { kmSplitsFromLaps } from '@/lib/activities/km-splits';
import { readStoredLaps } from '@/lib/plan-execution/laps';

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
    // The splits the UI draws, on the kilometre grid it labels them with.
    //
    // Two columns hold the same run at different grains, and both are unreliable:
    // `splits` was written by /api/garmin/activity-details, which has no callers
    // left (589 of the club's last 595 runs have none) and sometimes stored
    // Garmin's AGGREGATED summaries — two "splits" for a 12 km run. `laps` is
    // per lap press, which on a workout run is per STEP: 31 laps for 15 km, with
    // a median of 140 m.
    //
    // So: take whichever is the finer record of the run, then bin it into real
    // kilometres. The old fallback did neither — it read Strava's `moving_time`
    // off Garmin laps, so every Garmin run shipped splits of 0:00 at pace 0:00,
    // which is the splits table of zeroes, the pace chart pinned flat against a
    // y-axis labelled "-1:-28", and "0 of 31 kilometres inside the target band"
    // reported about a run whose laps were all there.
    const stored = readStoredLaps(r.splits);
    const lapped = readStoredLaps(r.laps);
    const splits = kmSplitsFromLaps(stored.length >= lapped.length ? stored : lapped);

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
