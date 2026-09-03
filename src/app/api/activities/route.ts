/**
 * GET /api/activities?athleteId=&include=gps&limit=
 *
 * Lists athlete_activities for the feed. Staff (coach/admin/academy_coach)
 * may omit athleteId for the club roster; runners must pass their own id.
 *
 * `limit` is optional, 1..200, and defaults to 200 (what this route always
 * returned). Pass a small one when you only need the newest few rows.
 *
 * `gps_points` (full per-run GPS trace, ~30-60KB/row) is excluded by default —
 * most callers only need distance/duration/pace/has_polyline and fetch the
 * route lazily per-card via /api/activities/details. Pass `include=gps` to
 * get it inline for consumers (e.g. the activities feed) that render the
 * route straight from the list without a follow-up fetch.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/** Largest page this route has ever returned, and still its default. */
const MAX_LIMIT = 200;

/** `?limit=` → 1..MAX_LIMIT, defaulting to MAX_LIMIT for anything unparseable. */
function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return MAX_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const includeGps = searchParams.get('include') === 'gps';
    // Rows are wide — `splits` and `laps` are per-km / per-lap JSONB — so a caller
    // that only needs to know whether ANY activity exists was downloading up to
    // 200 fully-populated runs to set a boolean (/dashboard/profile did exactly
    // that). Clamped to the old default so no caller can ask for more than before.
    const limit = clampLimit(searchParams.get('limit'));

    // The doc comment above was the intended contract but nothing enforced it:
    // staff-ness came from an unverified x-user-email (forge a coach's address
    // and the athlete_id filter dropped, returning the whole club's names, HR
    // and GPS traces), and a runner's own athleteId was never checked against
    // who they actually were — any athlete UUID returned that athlete's last
    // 200 activities to anyone who asked. requireCallerForAthlete enforces both
    // halves from the session: omitting the id means "the whole club", so it's
    // staff-only, and naming an id requires being that athlete or staff.
    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    const isStaff = caller.isSuperUser || caller.isStaff;

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
        .limit(limit);
      // Staff deliberately get the club-wide list even when they named an
      // athlete — the coach screens filter client-side and rely on having
      // everyone. Unchanged here; the gate above is what decides who counts as
      // staff in the first place.
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
