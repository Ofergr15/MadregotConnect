import type { createServerClient } from '@/lib/supabase/server';
import type { GroupedWeeklyPlans, ParsedWeeklyPlan, ParsedWorkout } from '@/lib/ai/types';
import type { PlannedWorkout } from '@/lib/run-chat/mock-workout';
import {
  parsedWorkoutToClipboard,
  workoutToClipboardText,
} from '@/lib/plans/clipboard';
import { matchAthleteActivities } from '@/lib/plans/match-athlete-activities';

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

export async function ensureMatchedWorkout(
  supabase: SupabaseServer,
  activityId: string,
  athleteId: string,
): Promise<MatchedWorkout | null> {
  try {
    const existing = await lookup(supabase, activityId);
    if (existing) return existing;
    await matchAthleteActivities(supabase, athleteId);
    return await lookup(supabase, activityId);
  } catch (error) {
    // Keep chat available while migration 043 is being rolled out.
    console.warn(`Matched workout lookup for ${activityId} skipped:`, error);
    return null;
  }
}
