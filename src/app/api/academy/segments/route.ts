import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { GarminClient } from '@/lib/garmin/client';
import { activityLocalDateStr } from '@/lib/utils';
import { ParsedWorkout } from '@/lib/ai/types';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { flattenPlannedSteps, matchLapsToSteps, Lap } from '@/lib/academy/segments';

export const dynamic = 'force-dynamic';

function extractWorkouts(parsed: any): ParsedWorkout[] {
  if (!parsed) return [];
  if (Array.isArray(parsed.workouts)) return parsed.workouts;
  for (const key of ['group1', 'group2', 'group3']) {
    if (parsed[key]?.workouts && Array.isArray(parsed[key].workouts)) return parsed[key].workouts;
  }
  for (const val of Object.values(parsed)) {
    if (val && typeof val === 'object' && Array.isArray((val as any).workouts)) return (val as any).workouts;
  }
  return [];
}
function sundayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().split('T')[0];
}

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

    const supabase = createServerClient();
    const weekStart = sundayOf(date);
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
    const { paceSec } = (await loadAcademySettings()).tolerances;

    // 1) Planned workout for that day — the athlete's individual plan wins (newest,
    //    tolerating duplicates), else the coach-wide shared plan (athlete_id NULL).
    let workouts: ParsedWorkout[] = [];
    const indiv = await supabase
      .from('weekly_plans').select('parsed_workouts, created_at')
      .eq('week_start_date', weekStart).eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    if (!indiv.error && indiv.data && indiv.data.length) {
      workouts = extractWorkouts(indiv.data[0].parsed_workouts);
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
      workouts = shared.data?.length ? extractWorkouts(shared.data[0].parsed_workouts) : [];
    }
    const planned = workouts.find(w => w.dayOfWeek === dayOfWeek);
    if (!planned) {
      return NextResponse.json({ segments: [], aligned: false, reason: 'no planned workout for this day' });
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
