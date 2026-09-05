import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { GarminClient } from '@/lib/garmin/client';
import { activityLocalDateStr, planWeekStartOf } from '@/lib/utils';
import { ParsedWorkout } from '@/lib/ai/types';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { requireCallerForAthlete, requireMember } from '@/lib/auth/self-or-staff';
import { flattenPlannedSteps, matchLapsToSteps, buildPlannedBands, Lap } from '@/lib/academy/segments';
import { groupNumberForAthlete } from '@/lib/plans/match-athlete-activities';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';

export const dynamic = 'force-dynamic';
/**
 * GET /api/academy/segments?athleteId=&date=YYYY-MM-DD
 * Per-segment planned-vs-actual verdicts for one athlete's workout on a date.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const date = searchParams.get('date');
    if (!athleteId || !date) {
      return NextResponse.json({ error: 'athleteId and date are required' }, { status: 400 });
    }

    // Two different trust levels behind one route. `bands` returns only the
    // day's PLANNED paces — club training content, and the feed requests it for
    // whoever's activity is being expanded, so any member may. The default mode
    // returns that athlete's own laps and per-segment verdicts: self-or-staff.
    if (searchParams.get('bands')) {
      const denied = await requireMember(request);
      if (denied) return denied;
    } else {
      const { denied } = await requireCallerForAthlete(request, athleteId);
      if (denied) return denied;
    }

    const supabase = createServerClient();
    const weekStart = planWeekStartOf(date);
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
    const { paceSec } = (await loadAcademySettings()).tolerances;

    // Which of the three pace lanes this athlete runs. It has to be resolved
    // before any plan is read: grading a group-3 athlete's laps against group 1's
    // paces is exactly the false "slower than target" verdict that the adherence
    // engine stopped producing, and this route was still doing it — it took
    // whichever group bucket appeared first in the blob, which is always group 1.
    // Started here and awaited after the plan read below, so its two round trips
    // overlap that one instead of adding to the response time.
    const lanePromise = groupNumberForAthlete(supabase, athleteId);

    // 1) Planned workout for that day — the athlete's individual plan wins (newest,
    //    tolerating duplicates), else the coach-wide shared plan (athlete_id NULL).
    let workouts: ParsedWorkout[] = [];
    const indiv = await supabase
      .from('weekly_plans').select('parsed_workouts, created_at')
      .eq('week_start_date', weekStart).eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    // laneWorkouts reads either stored shape: the pre-split group buckets of
    // older rows, or a unified plan, which it runs through splitIntoGroups so
    // "3:20 (3:30) ((3:40))" resolves down to the one pace this athlete was
    // actually asked to run. An individual plan goes through it too — it's
    // single-lane, so a plain plan comes back untouched, and one that does carry
    // bracket notation resolves to this athlete's lane rather than the fastest.
    const lane = (await lanePromise) as Lane;
    if (!indiv.error && indiv.data && indiv.data.length) {
      workouts = laneWorkouts(indiv.data[0].parsed_workouts, lane);
    } else {
      let shared = await supabase
        .from('weekly_plans').select('parsed_workouts, created_at')
        .eq('coach_id', COACH_ID).eq('week_start_date', weekStart)
        .is('athlete_id', null)
        .order('created_at', { ascending: false });
      if (shared.error) {
        shared = await supabase
          .from('weekly_plans').select('parsed_workouts, created_at')
          .eq('coach_id', COACH_ID).eq('week_start_date', weekStart)
          .order('created_at', { ascending: false });
      }
      workouts = shared.data?.length ? laneWorkouts(shared.data[0].parsed_workouts, lane) : [];
    }
    const planned = workouts.find(w => w.dayOfWeek === dayOfWeek);
    if (!planned) {
      if (searchParams.get('bands')) return NextResponse.json({ bands: null, reason: 'no planned workout for this day' });
      return NextResponse.json({ segments: [], aligned: false, reason: 'no planned workout for this day' });
    }

    // Chart-overlay mode: return the planned pace BANDS on a meter timeline. The
    // client projects them onto the activity's actual split distances (splits are
    // not always 1km). No lap fetch needed. bands:null → the day has no paced plan.
    if (searchParams.get('bands')) {
      const bands = buildPlannedBands(planned);
      return NextResponse.json({ bands: bands.length ? bands : null, workoutName: planned.name });
    }

    // 2) The matched activity for that date, with its stored laps.
    const { data: acts } = await supabase
      .from('athlete_activities')
      .select('id, garmin_activity_id, start_time, distance, laps')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${date}T00:00:00Z`)
      .lte('start_time', `${date}T23:59:59Z`);
    const dayActs = (acts || []).filter((a: any) => activityLocalDateStr(a.start_time) === date);
    // Pick the activity closest to planned distance (mirrors adherence matching).
    const plannedDist = (planned.distanceMinKm || 0) * 1000;
    const activity = dayActs.sort((a: any, b: any) =>
      Math.abs((a.distance || 0) - plannedDist) - Math.abs((b.distance || 0) - plannedDist))[0] || null;

    if (!activity) {
      return NextResponse.json({ segments: [], aligned: false, reason: 'no completed activity on this day' });
    }

    // 3) Ensure laps — fetch on-demand from Garmin if not cached.
    let laps: Lap[] = Array.isArray(activity.laps) ? activity.laps : [];
    if (laps.length === 0) {
      const { data: ath } = await supabase
        .from('athletes').select('garmin_auth').eq('id', athleteId).maybeSingle();
      if (ath?.garmin_auth) {
        try {
          const client = new GarminClient(ath.garmin_auth as any);
          const lapData = await client.getActivitySplits(Number(activity.garmin_activity_id));
          if (Array.isArray(lapData) && lapData.length > 1) {
            laps = lapData.map((lap: any) => ({
              distance: lap.distance || 0,
              duration: lap.duration || lap.movingDuration || 0,
              averagePace: lap.distance > 0 ? Math.round((lap.duration || lap.movingDuration || 0) / (lap.distance / 1000)) : null,
            }));
            // Best-effort cache back (ignore if column unmigrated).
            await supabase.from('athlete_activities').update({ laps })
              .eq('id', activity.id).then(() => {}, () => {});
          }
        } catch { /* laps optional */ }
      }
    }

    // 4) Flatten + match + grade.
    const flat = flattenPlannedSteps(planned);
    const report = matchLapsToSteps(flat, laps, paceSec);
    return NextResponse.json(report);
  } catch (error: any) {
    console.error('Academy segments error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute segments' }, { status: 500 });
  }
}
