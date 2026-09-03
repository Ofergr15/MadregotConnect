import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import type { GroupedWeeklyPlans, ParsedWeeklyPlan, ParsedWorkout } from '@/lib/ai/types';
import { groupNumberForAthlete, isMissingMatchesTable } from '@/lib/plans/match-athlete-activities';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';

export const dynamic = 'force-dynamic';

// Every write path that reaches activity_plan_matches needs this table. Until the
// migration is applied the honest answer is "not yet", not a raw Postgres error.
const MATCHES_UNAVAILABLE =
  'Manual plan matching is unavailable until migration 054_activity_plan_matches.sql is applied.';

// Normalized so the plan weeks published before the write paths normalized still
// expose a `workoutKey` here — a workout without one can be neither offered to the
// coach nor matched. See lib/plans/normalize-plan.ts.
function planForGroup(value: unknown, group: number): ParsedWeeklyPlan | null {
  const normalized = normalizeParsedWorkouts(value);
  const grouped = normalized as Partial<GroupedWeeklyPlans> | null;
  const selected = grouped?.[`group${group}` as keyof GroupedWeeklyPlans];
  if (selected?.workouts) return selected;
  const plan = normalized as ParsedWeeklyPlan | null;
  return Array.isArray(plan?.workouts) ? plan : null;
}

/**
 * The workouts a coach may choose from, across all three group variants.
 *
 * This used to return group 1's workouts unconditionally while PUT validated the
 * chosen key against the ATHLETE's group — so for every group-2 and group-3
 * athlete the only keys the UI could offer were ones PUT would reject with a 400.
 * Deduped by `workoutKey` because the three variants normally share a day/part
 * structure and differ only in pace.
 */
function selectableWorkouts(value: unknown): ParsedWorkout[] {
  const out: ParsedWorkout[] = [];
  const seen = new Set<string>();
  for (const group of [1, 2, 3]) {
    for (const workout of planForGroup(value, group)?.workouts || []) {
      if (!workout.workoutKey || seen.has(workout.workoutKey)) continue;
      seen.add(workout.workoutKey);
      out.push(workout);
    }
  }
  return out;
}

/**
 * Resolve a coach-chosen key, preferring the athlete's own group variant but
 * accepting a key that only exists in another group — a manual override is an
 * explicit staff decision, and refusing it because the variants disagree about a
 * part's kind would leave the coach no way to record what actually happened.
 */
function findWorkout(
  value: unknown,
  workoutKey: string,
  preferredGroup: number,
): ParsedWorkout | null {
  const order = [preferredGroup, 1, 2, 3].filter((g, i, arr) => arr.indexOf(g) === i);
  for (const group of order) {
    const workout = planForGroup(value, group)?.workouts.find(
      (candidate: ParsedWorkout) => candidate.workoutKey === workoutKey,
    );
    if (workout) return workout;
  }
  return null;
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
    // A missing activity_plan_matches table means no matches exist, not a broken
    // page: without this guard the whole match-review panel 500s.
    if (matchesError && !isMissingMatchesTable(matchesError)) throw matchesError;

    const athleteIds = Array.from(new Set((activities || []).map((activity) => activity.athlete_id)));
    const { data: athletes } = athleteIds.length
      ? await supabase.from('athletes').select('id, name').in('id', athleteIds)
      : { data: [] as Array<{ id: string; name: string }> };
    return NextResponse.json({
      plan,
      workouts: selectableWorkouts(plan.parsed_workouts),
      activities,
      matches: matches || [],
      matchesAvailable: !matchesError,
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
      if (error) {
        if (isMissingMatchesTable(error)) {
          return NextResponse.json({ error: MATCHES_UNAVAILABLE }, { status: 503 });
        }
        throw error;
      }
      return NextResponse.json({ match: null });
    }

    const groupNumber = await groupNumberForAthlete(supabase, activity.athlete_id);
    const workout = findWorkout(plan.parsed_workouts, workoutKey, groupNumber);
    if (!workout) {
      return NextResponse.json({ error: 'Workout part not found in this plan' }, { status: 400 });
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
    if (error) {
      if (isMissingMatchesTable(error)) {
        return NextResponse.json({ error: MATCHES_UNAVAILABLE }, { status: 503 });
      }
      throw error;
    }
    return NextResponse.json({ match });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
