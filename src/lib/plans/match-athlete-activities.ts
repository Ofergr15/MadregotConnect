import type { createServerClient } from '@/lib/supabase/server';
import type { GroupedWeeklyPlans, ParsedWeeklyPlan, ParsedWorkout } from '@/lib/ai/types';
import { activityLocalDateStr, resolveGroup } from '@/lib/utils';
import { matchActivityParts, type MatchableActivity } from './activity-matcher';

type SupabaseServer = ReturnType<typeof createServerClient>;

function isGrouped(value: unknown): value is GroupedWeeklyPlans {
  const object = value as Partial<GroupedWeeklyPlans> | null;
  return Boolean(object?.group1?.workouts && object?.group2?.workouts && object?.group3?.workouts);
}

function workoutPlanForGroup(value: unknown, groupNumber: number): ParsedWeeklyPlan | null {
  if (isGrouped(value)) return value[`group${groupNumber}` as keyof GroupedWeeklyPlans];
  const plan = value as ParsedWeeklyPlan | null;
  return Array.isArray(plan?.workouts) ? plan : null;
}

function dateForPlanDay(weekStart: string, dayOfWeek: number): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayOfWeek);
  return date.toISOString().slice(0, 10);
}

export async function groupNumberForAthlete(
  supabase: SupabaseServer,
  athleteId: string,
): Promise<number> {
  const { data: athlete } = await supabase
    .from('athletes')
    .select('group_id')
    .eq('id', athleteId)
    .maybeSingle();
  if (!athlete?.group_id) return 2;
  const { data: group } = await supabase
    .from('groups')
    .select('name')
    .eq('id', athlete.group_id)
    .maybeSingle();
  const index = resolveGroup(group?.name).index;
  return index >= 0 ? index + 1 : 2;
}

/**
 * Recomputes automatic matches for every published plan that overlaps the
 * athlete's stored activities. Manual overrides remain untouched.
 */
export async function matchAthleteActivities(
  supabase: SupabaseServer,
  athleteId: string,
): Promise<{ matched: number; plans: number }> {
  const { data: planRows, error: planError } = await supabase
    .from('weekly_plans')
    .select('id, week_start_date, athlete_id, parsed_workouts, created_at')
    .in('status', ['pushed', 'partial'])
    .or(`athlete_id.eq.${athleteId},athlete_id.is.null`)
    .order('created_at', { ascending: false });
  if (planError) throw planError;

  // One plan per week: an athlete-specific plan wins over the group plan.
  const plansByWeek = new Map<string, (typeof planRows)[number]>();
  for (const plan of planRows || []) {
    const current = plansByWeek.get(plan.week_start_date);
    if (!current || (!current.athlete_id && plan.athlete_id === athleteId)) {
      plansByWeek.set(plan.week_start_date, plan);
    }
  }
  if (plansByWeek.size === 0) return { matched: 0, plans: 0 };

  const { data: activities, error: activityError } = await supabase
    .from('athlete_activities')
    .select('id, start_time, distance, activity_name')
    .eq('athlete_id', athleteId)
    .order('start_time', { ascending: true });
  if (activityError) throw activityError;

  const groupNumber = await groupNumberForAthlete(supabase, athleteId);
  let matched = 0;

  for (const plan of plansByWeek.values()) {
    const groupPlan = workoutPlanForGroup(plan.parsed_workouts, groupNumber);
    if (!groupPlan) continue;

    const weekEnd = dateForPlanDay(plan.week_start_date, 6);
    const weekActivities = (activities || []).filter((activity) => {
      const date = activityLocalDateStr(activity.start_time);
      return date >= plan.week_start_date && date <= weekEnd;
    }) as MatchableActivity[];

    const { data: manualMatches, error: manualError } = await supabase
      .from('activity_plan_matches')
      .select('activity_id, workout_key')
      .eq('athlete_id', athleteId)
      .eq('weekly_plan_id', plan.id)
      .eq('match_method', 'manual');
    if (manualError) throw manualError;

    const manualActivityIds = new Set((manualMatches || []).map((match) => match.activity_id));
    const manualWorkoutKeys = new Set((manualMatches || []).map((match) => match.workout_key));
    await supabase
      .from('activity_plan_matches')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('weekly_plan_id', plan.id)
      .eq('match_method', 'auto');

    const availableActivities = weekActivities.filter(
      (activity) => !manualActivityIds.has(activity.id),
    );
    const availableWorkouts = groupPlan.workouts.filter(
      (workout: ParsedWorkout) =>
        workout.workoutKey && !manualWorkoutKeys.has(workout.workoutKey),
    );
    const matches = matchActivityParts(availableActivities, availableWorkouts);
    if (!matches.length) continue;

    const { error: insertError } = await supabase.from('activity_plan_matches').insert(
      matches.map((match) => ({
        activity_id: match.activityId,
        athlete_id: athleteId,
        weekly_plan_id: plan.id,
        workout_key: match.workoutKey,
        group_number: groupNumber,
        match_method: 'auto',
        score: match.score,
        evidence: match.evidence,
      })),
    );
    if (insertError) throw insertError;
    matched += matches.length;
  }

  return { matched, plans: plansByWeek.size };
}
