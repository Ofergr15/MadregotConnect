/**
 * GET /api/activities?athleteId=&include=gps&limit=&scope=self&shape=volume&since=
 *
 * Lists athlete_activities for the feed. Staff (coach/admin/academy_coach)
 * may omit athleteId for the club roster; runners must pass their own id.
 *
 * `limit` is optional, 1..200, and defaults to 200 (what this route always
 * returned). Pass a small one when you only need the newest few rows.
 *
 * `scope=self` restricts the response to `athleteId`'s own rows even for staff,
 * who are otherwise widened to the whole club. A coach who is also a runner
 * needs this on their personal screens — see the comment on `scopeSelf` below.
 *
 * `gps_points` (full per-run GPS trace, ~30-60KB/row) is excluded by default —
 * most callers only need distance/duration/pace/has_polyline and fetch the
 * route lazily per-card via /api/activities/details. Pass `include=gps` to
 * get it inline for consumers (e.g. the activities feed) that render the
 * route straight from the list without a follow-up fetch.
 *
 * `shape=volume` returns only `id, athlete_id, start_time, distance` — enough to
 * total km per week and nothing else. `since=<ISO date>` and `until=<ISO date>`
 * bound start_time (`until` is exclusive — pass the day after the last one you
 * want). All three are narrowing-only, like `scope=self`: none can widen what a
 * caller sees, so none needs its own authorization.
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
    // `scope=self` means "only this athlete's rows, even if I'm staff". Staff are
    // otherwise widened to the whole club below, which every personal screen then
    // has to filter client-side — and that combination is silently wrong for a
    // coach who is ALSO a runner: their own runs have to be inside the newest N
    // club-wide rows to survive the filter, so on a busy week the club's admin
    // could open their dashboard and see "0 runs this week". It also makes any
    // `limit` unusable for those screens. Narrowing only, on an id the gate below
    // has already authorised.
    const scopeSelf = searchParams.get('scope') === 'self';
    // `shape=volume` — the only thing needed to add up km per week. The feed's
    // WeeklyLeaderboardCard was pulling 32 columns × every run the athlete has
    // ever logged (measured: 113 KB / 138 rows / 5.2 s) to produce thirteen
    // numbers — this week's km and twelve weekly totals — and threw the rest,
    // `laps` JSONB included, straight away. Four columns answer that question.
    //
    // Narrowing only, exactly like `scope=self` above: a projection can only
    // ever REMOVE columns from a row the gate has already authorised, so there
    // is no value of this parameter that widens what anyone can see.
    const volumeShape = searchParams.get('shape') === 'volume';
    // `since` — an ISO date floor, for callers that want a window rather than a
    // count. `limit` can't express "the last twelve weeks": it's a row count, so
    // the answer changes with how often someone runs, and a high-mileage athlete
    // silently loses the oldest weeks off the chart. Ignored unless it parses,
    // and it can only ever remove rows.
    const sinceRaw = searchParams.get('since');
    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null;
    // `until` closes the window at the top, for a screen showing one specific
    // week rather than "the most recent N". Without an upper bound, a caller
    // asking for an OLD week has to take the newest rows and throw most of them
    // away — and, worse, only finds that week at all if it happens to fall inside
    // whatever `limit` reached back to. Same narrowing-only guarantee.
    const untilRaw = searchParams.get('until');
    const until = untilRaw && !Number.isNaN(Date.parse(untilRaw)) ? untilRaw : null;

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

    // Four columns, and every one of them is read: athlete_id to confirm the row
    // is mine, start_time to bucket it into a week, distance to add up, id as the
    // key. Deliberately NOT a subset of a "summary" shape someone might extend
    // later — if a caller needs another field it should say so here, so the cost
    // of widening this stays visible.
    const volumeCols = `id, athlete_id, start_time, distance`;

    const baseCols = `
        id, athlete_id, garmin_activity_id, strava_activity_id, source,
        activity_name, activity_type,
        start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr,
        calories, elevation_gain, start_lat, start_lng, end_lat, end_lng,
        avg_cadence, avg_stride_length, vo2max, lap_count, location_name,
        perceived_rpe, perceived_feel,
        has_polyline, splits, laps, created_at,
        athletes (name)`;

    const runQuery = (cols: string) => {
      let q = supabase
        .from('athlete_activities')
        .select(cols)
        .order('start_time', { ascending: false })
        .limit(limit);
      // Staff otherwise get the club-wide list even when they named an athlete —
      // the coach screens filter client-side and rely on having everyone — so a
      // personal screen has to opt out with `scope=self`. Either way this can
      // only ever ADD the filter: there is no combination of parameters that
      // widens a runner past their own rows, and `athleteId` has already been
      // checked against the session by the gate above.
      if (athleteId && (!isStaff || scopeSelf)) q = q.eq('athlete_id', athleteId);
      if (since) q = q.gte('start_time', since);
      // `lt`, not `lte`: callers pass a date-only bound, so the natural way to say
      // "through Saturday" is to pass the following Sunday. `lte` on a bare date
      // would compare against midnight and drop that whole last day.
      if (until) q = q.lt('start_time', until);
      return q;
    };

    let activities: any[] | null = null;
    let error: any = null;
    if (volumeShape) {
      // Checked before `includeGps` on purpose: the two are contradictory (the
      // whole point of this shape is to not ship blobs), and a caller that sends
      // both should get the narrow answer rather than the wide one.
      ({ data: activities, error } = await runQuery(volumeCols));
    } else if (includeGps) {
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

    // The volume shape has no `athletes` join to flatten, and stamping every row
    // with athlete_name:'Unknown' would both add bytes and invent a fact.
    if (volumeShape) return NextResponse.json({ activities: activities || [] });

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
