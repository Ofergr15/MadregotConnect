import type { createServerClient } from '@/lib/supabase/server';
import type { GroupedWeeklyPlans, ParsedWeeklyPlan, ParsedWorkout } from '@/lib/ai/types';
import type { PlannedWorkout } from '@/lib/run-chat/mock-workout';
import {
  parsedWorkoutToClipboard,
  workoutToClipboardText,
} from '@/lib/plans/clipboard';
import {
  findComputedActivityMatch,
  isMissingMatchesTable,
  matchAthleteActivities,
} from '@/lib/plans/match-athlete-activities';

type SupabaseServer = ReturnType<typeof createServerClient>;

export interface MatchedWorkout {
  weeklyPlanId: string;
  workoutKey: string;
  groupNumber: number;
  matchMethod: 'auto' | 'manual';
  score: number | null;
  workout: ParsedWorkout;
  plannedText: string;
  plannedWorkout: PlannedWorkout;
  clipboardImageUrl: string | null;
}

function selectPlan(value: unknown, groupNumber: number): ParsedWeeklyPlan | null {
  const grouped = value as Partial<GroupedWeeklyPlans> | null;
  const selected = grouped?.[`group${groupNumber}` as keyof GroupedWeeklyPlans];
  if (selected?.workouts) return selected;
  const plan = value as ParsedWeeklyPlan | null;
  return Array.isArray(plan?.workouts) ? plan : null;
}

async function lookup(
  supabase: SupabaseServer,
  activityId: string,
): Promise<MatchedWorkout | null> {
  const { data: match, error: matchError } = await supabase
    .from('activity_plan_matches')
    .select('weekly_plan_id, workout_key, group_number, match_method, score')
    .eq('activity_id', activityId)
    .maybeSingle();
  if (matchError) throw matchError;
  if (!match) return null;

  const { data: weeklyPlan, error: planError } = await supabase
    .from('weekly_plans')
    .select('id, parsed_workouts')
    .eq('id', match.weekly_plan_id)
    .maybeSingle();
  if (planError) throw planError;
  if (!weeklyPlan) return null;

  const workout = selectPlan(weeklyPlan.parsed_workouts, match.group_number)?.workouts.find(
    (candidate: ParsedWorkout) => candidate.workoutKey === match.workout_key,
  );
  if (!workout) return null;
  const plannedText = workout.clipboardText || workoutToClipboardText(workout);
  const clipboard = parsedWorkoutToClipboard({ ...workout, clipboardText: plannedText });
  return {
    weeklyPlanId: weeklyPlan.id,
    workoutKey: match.workout_key,
    groupNumber: match.group_number,
    matchMethod: match.match_method,
    score: match.score == null ? null : Number(match.score),
    workout,
    plannedText,
    plannedWorkout: {
      ...clipboard,
      source: {
        weeklyPlanId: weeklyPlan.id,
        workoutKey: match.workout_key,
        groupNumber: match.group_number,
        matchMethod: match.match_method,
        matchScore: match.score == null ? null : Number(match.score),
      },
      structured: workout,
    } as PlannedWorkout,
    clipboardImageUrl: workout.clipboardImageUrl || null,
  };
}

function toMatchedWorkout(
  computed: Awaited<ReturnType<typeof findComputedActivityMatch>>,
): MatchedWorkout | null {
  if (!computed) return null;
  const plannedText = computed.workout.clipboardText || workoutToClipboardText(computed.workout);
  const clipboard = parsedWorkoutToClipboard({ ...computed.workout, clipboardText: plannedText });
  return {
    weeklyPlanId: computed.weeklyPlanId,
    workoutKey: computed.workoutKey,
    groupNumber: computed.groupNumber,
    matchMethod: 'auto',
    score: computed.score,
    workout: computed.workout,
    plannedText,
    plannedWorkout: {
      ...clipboard,
      source: {
        weeklyPlanId: computed.weeklyPlanId,
        workoutKey: computed.workoutKey,
        groupNumber: computed.groupNumber,
        matchMethod: 'auto',
        matchScore: computed.score,
      },
      structured: computed.workout,
    } as PlannedWorkout,
    clipboardImageUrl: computed.workout.clipboardImageUrl || null,
  };
}

export async function ensureMatchedWorkout(
  supabase: SupabaseServer,
  activityId: string,
  athleteId: string,
): Promise<MatchedWorkout | null> {
  try {
    const existing = await lookup(supabase, activityId);
    if (existing) return existing;
    await matchAthleteActivities(supabase, athleteId);
    const persisted = await lookup(supabase, activityId);
    if (persisted) return persisted;
    return toMatchedWorkout(await findComputedActivityMatch(supabase, activityId, athleteId));
  } catch (error) {
    if (!isMissingMatchesTable(error)) {
      console.warn(`Matched workout lookup for ${activityId} skipped:`, error);
    }
    try {
      return toMatchedWorkout(await findComputedActivityMatch(supabase, activityId, athleteId));
    } catch (computeError) {
      console.warn(`Matched workout compute for ${activityId} skipped:`, computeError);
      return null;
    }
  }
}
