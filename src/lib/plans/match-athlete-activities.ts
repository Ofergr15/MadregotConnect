import type { createServerClient } from '@/lib/supabase/server';
import type { GroupedWeeklyPlans, ParsedWeeklyPlan, ParsedWorkout } from '@/lib/ai/types';
import { activityLocalDateStr, resolveGroup } from '@/lib/utils';
import { matchActivityParts, type MatchableActivity } from './activity-matcher';
import { normalizeParsedWorkouts } from './normalize-plan';
import {
  pairByGarminWorkoutId,
  type ActivityWithGarminWorkout,
  type GarminWorkoutMatch,
} from './garmin-workout-matches';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * Where a match came from, best evidence first.
 *
 * `manual` is a coach's explicit decision and outranks everything. `garmin_workout`
 * is the watch's own answer — the activity carries the id of the workout it was
 * started from (see garmin-workout-matches.ts) — so it outranks `auto`, which is
 * activity-matcher.ts scoring day and distance. Ranking matters because
 * `activity_plan_matches` is unique on the activity and on the plan slot: only one
 * of the three can hold a given pair.
 */
export type MatchMethod = 'manual' | 'garmin_workout' | 'auto';

/** Both derived methods are recomputed from scratch; only `manual` is preserved. */
const DERIVED_METHODS: MatchMethod[] = ['auto', 'garmin_workout'];

type ActivityRow = MatchableActivity & ActivityWithGarminWorkout;

/**
 * The athlete's activities, with the Garmin workout id when the database has that
 * column. Falls back to the pre-092 shape rather than failing every match: without
 * the id there is simply no exact evidence to use, which is where this code was
 * before the column existed.
 */
async function loadActivities(
  supabase: SupabaseServer,
  athleteId: string,
): Promise<ActivityRow[]> {
  const columns = 'id, start_time, distance, activity_name';
  const withWorkoutId = await supabase
    .from('athlete_activities')
    .select(`${columns}, garmin_workout_id`)
    .eq('athlete_id', athleteId)
    .order('start_time', { ascending: true });
  if (!withWorkoutId.error) return (withWorkoutId.data || []) as ActivityRow[];
  if (!isMissingColumn(withWorkoutId.error, 'garmin_workout_id')) throw withWorkoutId.error;

  const { data, error } = await supabase
    .from('athlete_activities')
    .select(columns)
    .eq('athlete_id', athleteId)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []) as ActivityRow[];
}

/**
 * The workouts pushed to this athlete for this plan, keyed for attribution.
 *
 * Returns [] — never throws — when migration 092 isn't applied: exact attribution
 * is an upgrade over the heuristic, so its absence has to degrade to the heuristic
 * rather than take plan matching down with it.
 */
async function loadDeliveries(
  supabase: SupabaseServer,
  planId: string,
  athleteId: string,
) {
  const { data, error } = await supabase
    .from('workout_deliveries')
    .select('id, garmin_workout_id, workout_key')
    .eq('plan_id', planId)
    .eq('athlete_id', athleteId)
    .not('garmin_workout_id', 'is', null)
    .neq('garmin_workout_id', '');
  if (error) {
    if (isMissingColumn(error, 'workout_key')) return [];
    throw error;
  }
  return data || [];
}

/**
 * Stamp the moment we learned the watch had these workouts. Best-effort by
 * design — this is a record of something that already happened, and failing to
 * write it must not cost the match it came from.
 */
async function markDeviceConfirmed(
  supabase: SupabaseServer,
  matches: GarminWorkoutMatch[],
): Promise<void> {
  if (matches.length === 0) return;
  // `.is(..., null)` so the stamp keeps the FIRST sighting: this is when the watch
  // was known to have the workout, and re-running the matcher must not push that
  // forward to now.
  const { error } = await supabase
    .from('workout_deliveries')
    .update({ device_confirmed_at: new Date().toISOString() })
    .in('id', matches.map((match) => match.deliveryId))
    .is('device_confirmed_at', null);
  if (error && !isMissingColumn(error, 'device_confirmed_at')) {
    console.warn('Device-confirmation stamp skipped:', error.message);
  }
}

export function isMissingMatchesTable(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    candidate?.code === 'PGRST205' ||
    /activity_plan_matches/i.test(candidate?.message || '')
  );
}

function isGrouped(value: unknown): value is GroupedWeeklyPlans {
  const object = value as Partial<GroupedWeeklyPlans> | null;
  return Boolean(object?.group1?.workouts && object?.group2?.workouts && object?.group3?.workouts);
}

/**
 * The group's plan, normalized on the way out.
 *
 * Normalizing HERE, on the read side, is what lets the nine plan weeks that were
 * saved before the write paths normalized (see lib/plans/normalize-plan.ts) start
 * matching without a data migration: `workoutKey` is derived deterministically
 * from dayOfWeek/partIndex/partKind, so a plan normalized lazily now gets exactly
 * the key it would have been given at publish time.
 */
export function workoutPlanForGroup(value: unknown, groupNumber: number): ParsedWeeklyPlan | null {
  const normalized = normalizeParsedWorkouts(value);
  if (isGrouped(normalized)) return normalized[`group${groupNumber}` as keyof GroupedWeeklyPlans];
  const plan = normalized as ParsedWeeklyPlan | null;
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

export type ComputedActivityMatch = {
  weeklyPlanId: string;
  workoutKey: string;
  groupNumber: number;
  score: number;
  /** 'garmin_workout' when the watch itself named the workout; see MatchMethod. */
  matchMethod: Exclude<MatchMethod, 'manual'>;
  workout: ParsedWorkout;
};

/**
 * Same-week pairing without writing activity_plan_matches. Used when that
 * table has not been applied yet, and as the source for persist.
 */
export async function findComputedActivityMatch(
  supabase: SupabaseServer,
  activityId: string,
  athleteId: string,
): Promise<ComputedActivityMatch | null> {
  const { data: planRows, error: planError } = await supabase
    .from('weekly_plans')
    .select('id, week_start_date, athlete_id, parsed_workouts, created_at')
    .in('status', ['pushed', 'partial'])
    .or(`athlete_id.eq.${athleteId},athlete_id.is.null`)
    .order('created_at', { ascending: false });
  if (planError) throw planError;

  const plansByWeek = new Map<string, (typeof planRows)[number]>();
  for (const plan of planRows || []) {
    const current = plansByWeek.get(plan.week_start_date);
    if (!current || (!current.athlete_id && plan.athlete_id === athleteId)) {
      plansByWeek.set(plan.week_start_date, plan);
    }
  }
  if (plansByWeek.size === 0) return null;

  const activities = await loadActivities(supabase, athleteId);
  const groupNumber = await groupNumberForAthlete(supabase, athleteId);

  for (const plan of plansByWeek.values()) {
    const groupPlan = workoutPlanForGroup(plan.parsed_workouts, groupNumber);
    if (!groupPlan) continue;
    const weekEnd = dateForPlanDay(plan.week_start_date, 6);
    const weekActivities = activities.filter((activity) => {
      const date = activityLocalDateStr(activity.start_time);
      return date >= plan.week_start_date && date <= weekEnd;
    });

    // Garmin's own attribution first, on the same precedence as the persisting
    // path — otherwise the run-chat and the coach's match panel could disagree
    // about the same activity, one showing a scored guess and the other the fact.
    const confirmed = pairByGarminWorkoutId(
      weekActivities,
      await loadDeliveries(supabase, plan.id, athleteId),
    ).find((match) => match.activityId === activityId);
    if (confirmed) {
      const workout = groupPlan.workouts.find(
        (candidate: ParsedWorkout) => candidate.workoutKey === confirmed.workoutKey,
      );
      if (workout) {
        return {
          weeklyPlanId: plan.id,
          workoutKey: confirmed.workoutKey,
          groupNumber,
          score: 100,
          matchMethod: 'garmin_workout',
          workout,
        };
      }
    }

    const matches = matchActivityParts(weekActivities as MatchableActivity[], groupPlan.workouts);
    const hit = matches.find((match) => match.activityId === activityId);
    if (!hit) continue;
    const workout = groupPlan.workouts.find(
      (candidate: ParsedWorkout) => candidate.workoutKey === hit.workoutKey,
    );
    if (!workout) continue;
    return {
      weeklyPlanId: plan.id,
      workoutKey: hit.workoutKey,
      groupNumber,
      score: hit.score,
      matchMethod: 'auto',
      workout,
    };
  }
  return null;
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

  const activities = await loadActivities(supabase, athleteId);
  const groupNumber = await groupNumberForAthlete(supabase, athleteId);
  let matched = 0;

  for (const plan of plansByWeek.values()) {
    const groupPlan = workoutPlanForGroup(plan.parsed_workouts, groupNumber);
    if (!groupPlan) continue;

    const weekEnd = dateForPlanDay(plan.week_start_date, 6);
    const weekActivities = activities.filter((activity) => {
      const date = activityLocalDateStr(activity.start_time);
      return date >= plan.week_start_date && date <= weekEnd;
    });

    const { data: manualMatches, error: manualError } = await supabase
      .from('activity_plan_matches')
      .select('activity_id, workout_key')
      .eq('athlete_id', athleteId)
      .eq('weekly_plan_id', plan.id)
      .eq('match_method', 'manual');
    if (manualError) {
      if (!isMissingMatchesTable(manualError)) throw manualError;
    }

    const manualActivityIds = new Set((manualMatches || []).map((match) => match.activity_id));
    const manualWorkoutKeys = new Set((manualMatches || []).map((match) => match.workout_key));

    // Both derived methods go, not just 'auto': a garmin_workout row is recomputed
    // from the deliveries every time too, and leaving stale ones behind would trip
    // the unique constraints on the way back in.
    const { error: deleteError } = await supabase
      .from('activity_plan_matches')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('weekly_plan_id', plan.id)
      .in('match_method', DERIVED_METHODS);
    if (deleteError && !isMissingMatchesTable(deleteError)) throw deleteError;

    // Garmin's own attribution, for the activities a coach hasn't already spoken
    // for. Only keys this group's plan actually still contains: a delivery survives
    // an edit to the plan it came from, and a match pointing at a workout that is
    // no longer there resolves to nothing for every reader.
    const confirmed = pairByGarminWorkoutId(
      weekActivities.filter((activity) => !manualActivityIds.has(activity.id)),
      await loadDeliveries(supabase, plan.id, athleteId),
    ).filter(
      (match) =>
        !manualWorkoutKeys.has(match.workoutKey) &&
        groupPlan.workouts.some(
          (workout: ParsedWorkout) => workout.workoutKey === match.workoutKey,
        ),
    );

    const claimedActivityIds = new Set([
      ...manualActivityIds,
      ...confirmed.map((match) => match.activityId),
    ]);
    const claimedWorkoutKeys = new Set([
      ...manualWorkoutKeys,
      ...confirmed.map((match) => match.workoutKey),
    ]);

    const availableActivities = weekActivities.filter(
      (activity) => !claimedActivityIds.has(activity.id),
    ) as MatchableActivity[];
    const availableWorkouts = groupPlan.workouts.filter(
      (workout: ParsedWorkout) =>
        workout.workoutKey && !claimedWorkoutKeys.has(workout.workoutKey),
    );
    const heuristic = matchActivityParts(availableActivities, availableWorkouts);

    const rows = [
      ...confirmed.map((match) => ({
        activity_id: match.activityId,
        athlete_id: athleteId,
        weekly_plan_id: plan.id,
        workout_key: match.workoutKey,
        group_number: groupNumber,
        match_method: 'garmin_workout',
        // Not a score: nothing was estimated. 100 so any reader ordering or
        // thresholding by score treats it as the strongest evidence there is.
        score: 100,
        evidence: {
          reason: 'garmin_workout_id',
          garminWorkoutId: match.garminWorkoutId,
          deliveryId: match.deliveryId,
        },
      })),
      ...heuristic.map((match) => ({
        activity_id: match.activityId,
        athlete_id: athleteId,
        weekly_plan_id: plan.id,
        workout_key: match.workoutKey,
        group_number: groupNumber,
        match_method: 'auto',
        score: match.score,
        evidence: match.evidence,
      })),
    ];
    if (!rows.length) continue;

    const { error: insertError } = await supabase.from('activity_plan_matches').insert(rows);
    if (insertError) {
      if (isMissingMatchesTable(insertError)) {
        matched += rows.length;
        continue;
      }
      throw insertError;
    }
    await markDeviceConfirmed(supabase, confirmed);
    matched += rows.length;
  }

  return { matched, plans: plansByWeek.size };
}
