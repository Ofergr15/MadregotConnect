import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import type { GroupedWeeklyPlans, ParsedWeeklyPlan, ParsedWorkout } from '@/lib/ai/types';
import { groupNumberForAthlete } from '@/lib/plans/match-athlete-activities';

export const dynamic = 'force-dynamic';

function planForGroup(value: unknown, group: number): ParsedWeeklyPlan | null {
  const grouped = value as Partial<GroupedWeeklyPlans> | null;
  const selected = grouped?.[`group${group}` as keyof GroupedWeeklyPlans];
  if (selected?.workouts) return selected;
  const plan = value as ParsedWeeklyPlan | null;
  return Array.isArray(plan?.workouts) ? plan : null;
}

async function loadPlan(planId: string) {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('id, week_start_date, parsed_workouts, status')
    .eq('id', planId)
    .maybeSingle();
  if (error) throw error;
  return { supabase, plan: data };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  const { planId } = await params;
  try {
    const { supabase, plan } = await loadPlan(planId);
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    const nextWeek = new Date(`${plan.week_start_date}T00:00:00Z`);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);

    const [{ data: activities, error: activitiesError }, { data: matches, error: matchesError }] =
      await Promise.all([
        supabase
          .from('athlete_activities')
          .select('id, athlete_id, start_time, activity_name, distance, average_pace, average_hr')
          .gte('start_time', `${plan.week_start_date}T00:00:00`)
          .lt('start_time', `${nextWeek.toISOString().slice(0, 10)}T00:00:00`)
          .order('start_time', { ascending: true }),
        supabase
          .from('activity_plan_matches')
          .select('*')
          .eq('weekly_plan_id', planId),
      ]);
    if (activitiesError) throw activitiesError;
    if (matchesError) throw matchesError;

    const athleteIds = Array.from(new Set((activities || []).map((activity) => activity.athlete_id)));
    const { data: athletes } = athleteIds.length
      ? await supabase.from('athletes').select('id, name').in('id', athleteIds)
      : { data: [] as Array<{ id: string; name: string }> };
    return NextResponse.json({
      plan,
      workouts: planForGroup(plan.parsed_workouts, 1)?.workouts || [],
      activities,
      matches,
      athletes,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  const { planId } = await params;
  try {
    const { activityId, workoutKey } = await request.json() as {
      activityId?: string;
      workoutKey?: string | null;
    };
    if (!activityId) return NextResponse.json({ error: 'activityId required' }, { status: 400 });
    const { supabase, plan } = await loadPlan(planId);
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    const { data: activity, error: activityError } = await supabase
      .from('athlete_activities')
      .select('id, athlete_id')
      .eq('id', activityId)
      .maybeSingle();
    if (activityError) throw activityError;
    if (!activity) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });

    if (!workoutKey) {
      const { error } = await supabase
        .from('activity_plan_matches')
        .delete()
        .eq('activity_id', activityId);
      if (error) throw error;
      return NextResponse.json({ match: null });
    }

    const groupNumber = await groupNumberForAthlete(supabase, activity.athlete_id);
    const workout = planForGroup(plan.parsed_workouts, groupNumber)?.workouts.find(
      (candidate: ParsedWorkout) => candidate.workoutKey === workoutKey,
    );
    if (!workout) {
      return NextResponse.json({ error: 'Workout part not found for athlete group' }, { status: 400 });
    }

    const { data: occupied } = await supabase
      .from('activity_plan_matches')
      .select('id, activity_id, match_method')
      .eq('athlete_id', activity.athlete_id)
      .eq('weekly_plan_id', planId)
      .eq('workout_key', workoutKey)
      .maybeSingle();
    if (occupied?.match_method === 'manual' && occupied.activity_id !== activityId) {
      return NextResponse.json(
        { error: 'That workout part is already manually matched to another activity' },
        { status: 409 },
      );
    }
    if (occupied) {
      await supabase.from('activity_plan_matches').delete().eq('id', occupied.id);
    }
    await supabase.from('activity_plan_matches').delete().eq('activity_id', activityId);

    const { data: match, error } = await supabase
      .from('activity_plan_matches')
      .insert({
        activity_id: activityId,
        athlete_id: activity.athlete_id,
        weekly_plan_id: planId,
        workout_key: workoutKey,
        group_number: groupNumber,
        match_method: 'manual',
        score: 100,
        evidence: { reason: 'staff_override' },
        overridden_by: auth.user.email,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ match });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
