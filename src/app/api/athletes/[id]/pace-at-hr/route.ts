import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { workoutPlanForGroup } from '@/lib/plans/match-athlete-activities';
import { classifyWorkout } from '@/lib/plans/session-summary';
import type { ParsedWorkout } from '@/lib/ai/types';
import { paceAtHr, type PaceRunInput, type RunKind } from '@/lib/fitness/pace-at-hr';

export const dynamic = 'force-dynamic';

const PERIODS: Record<string, number> = { '3m': 13, '2m': 9, '1y': 52 };
const RUN_TYPES = ['running', 'road_running', 'trail_running', 'track_running', 'treadmill_running', 'indoor_running'];

// GET /api/athletes/[id]/pace-at-hr?period=2m|3m|1y
//   -> paceAtHr(...) — "pace at the same heart rate" for the profile (#105).
//
// The athlete themself and staff (mayActFor), not every member: heart rate is
// health data, the same reason the seven-day card keeps sleep and resting HR to
// the owner (#69). Opening it to teammates is this one gate.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { denied } = await requireCallerForAthlete(request, id);
  if (denied) return denied;

  const period = new URL(request.url).searchParams.get('period') || '2m';
  const weeks = PERIODS[period] ?? PERIODS['2m'];
  const today = israelToday();
  // The window plus the 28 days the first point looks back over, and a day of slack.
  const since = addDaysToDateStr(today, -(7 * weeks + 29));

  try {
    const supabase = createServerClient();
    const runs = await fetchAllRows<PaceRunInput>((from, to) =>
      supabase.from('athlete_activities')
        .select('id, start_time, activity_type, distance, duration, laps')
        .eq('athlete_id', id)
        .in('activity_type', RUN_TYPES)
        .gte('start_time', `${since}T00:00:00`)
        .order('start_time', { ascending: true })
        .order('id')
        .range(from, to),
    );

    // The plan's word where there is one: a run matched to an interval/tempo/
    // fartlek workout is out, whatever its laps look like. A plan that reads
    // "easy" is not trusted the same way — classifyWorkout falls back to easy for
    // any session without repeats, so the laps still decide those.
    const planned = new Map<string, RunKind>();
    const ids = runs.map(r => r.id);
    if (ids.length) {
      const { data: matches } = await supabase.from('activity_plan_matches')
        .select('activity_id, weekly_plan_id, workout_key, group_number')
        .in('activity_id', ids);
      const planIds = [...new Set((matches || []).map(m => m.weekly_plan_id))];
      const { data: plans } = planIds.length
        ? await supabase.from('weekly_plans').select('id, parsed_workouts').in('id', planIds)
        : { data: [] as Array<{ id: string; parsed_workouts: unknown }> };
      const byId = new Map((plans || []).map(p => [p.id, p.parsed_workouts]));
      for (const m of matches || []) {
        const w = workoutPlanForGroup(byId.get(m.weekly_plan_id), m.group_number || 2)
          ?.workouts.find((x: ParsedWorkout) => x.workoutKey === m.workout_key);
        if (!w) continue;
        const type = classifyWorkout(w);
        if (type === 'intervals' || type === 'tempo' || type === 'fartlek') planned.set(m.activity_id, 'interval');
      }
    }

    return NextResponse.json(paceAtHr(runs, { today, weeks, planned }));
  } catch (err) {
    console.error('[pace-at-hr] failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
