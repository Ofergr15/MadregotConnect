/**
 * Plan vs. Execution — turning rows into verdicts.
 *
 * The DB half of the feature: find the workout a run was run FOR, then hand it
 * and the run to the existing adherence/segment engines and `buildVerdict`.
 *
 * Two entry points on purpose, because the two callers have opposite budgets:
 *
 *  - `resolveExecutionSummaries` — a feed page's worth of runs, three queries
 *    total, read-only, and it will NOT go looking for a match that isn't stored
 *    yet. A ring is worth three queries; it is not worth re-running the matcher
 *    for twenty athletes on every scroll.
 *  - `resolveExecutionVerdict` — one run, opened deliberately. This one goes
 *    through `ensureMatchedWorkout`, which computes and persists a match when
 *    none exists, so a run synced before the matcher last ran still gets graded.
 *
 * Laps are read from `athlete_activities.laps` and never fetched from Garmin
 * here. They're cached the first time anyone opens the run
 * (api/garmin/activity-details) and by the Strava sync, so this stays a pure read
 * and the feed and the detail screen agree on the same stored data.
 */

import type { createServerClient } from '@/lib/supabase/server';
import type { ParsedWorkout } from '@/lib/ai/types';
import type { ActualActivity, AdherenceTolerances } from '@/lib/academy/adherence';
import { assessWorkout, buildPlannedWorkout } from '@/lib/academy/adherence';
import { flattenPlannedSteps, matchLapsToSteps, type Lap, type SegmentReport } from '@/lib/academy/segments';
import { ensureMatchedWorkout } from '@/lib/plans/matched-workout';
import { isMissingMatchesTable, workoutPlanForGroup } from '@/lib/plans/match-athlete-activities';
import { activityLocalDateStr } from '@/lib/utils';
import {
  buildVerdict,
  toExecutionSummary,
  type ExecutionSummary,
  type ExecutionVerdict,
} from './verdict';

type SupabaseServer = ReturnType<typeof createServerClient>;

/** Columns a verdict needs off the activity row. */
const ACTIVITY_SELECT = `
  id, athlete_id, start_time, distance, duration, moving_duration,
  average_pace, activity_type, laps
`;

interface ActivityRow {
  id: string;
  athlete_id: string;
  start_time: string;
  distance: number | null;
  duration: number | null;
  moving_duration: number | null;
  average_pace: number | null;
  activity_type: string | null;
  laps: unknown;
}

function toActual(row: ActivityRow): ActualActivity {
  return {
    id: row.id,
    date: activityLocalDateStr(row.start_time),
    distance: row.distance ?? 0,
    duration: row.duration ?? 0,
    movingDuration: row.moving_duration,
    averagePace: row.average_pace,
    activityType: row.activity_type ?? undefined,
  };
}

/**
 * Stored laps, normalised to what `matchLapsToSteps` wants.
 *
 * Two writers with slightly different shapes feed this column (the Garmin detail
 * fetch and the Strava backfill), and an empty array is a real value there — it
 * means "checked, this run has no useful laps" — so it degrades to no reps rather
 * than being treated as missing.
 */
function toLaps(value: unknown): Lap[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): Lap | null => {
      const lap = raw as { distance?: unknown; duration?: unknown; averagePace?: unknown };
      const distance = Number(lap?.distance);
      const duration = Number(lap?.duration);
      if (!Number.isFinite(distance) || !Number.isFinite(duration)) return null;
      const pace = Number(lap?.averagePace);
      return {
        distance,
        duration,
        averagePace: Number.isFinite(pace) && pace > 0 ? pace : null,
      };
    })
    .filter((lap): lap is Lap => lap !== null);
}

function segmentReportFor(workout: ParsedWorkout, laps: Lap[], paceSec: number): SegmentReport | null {
  if (laps.length === 0) return null;
  return matchLapsToSteps(flattenPlannedSteps(workout), laps, paceSec);
}

/** The one place a (run, planned workout) pair becomes a verdict. */
function verdictFor(
  row: ActivityRow,
  workout: ParsedWorkout | null,
  tolerances: AdherenceTolerances,
): ExecutionVerdict {
  if (!workout) {
    return buildVerdict({
      activityId: row.id,
      athleteId: row.athlete_id,
      adherence: null,
      segments: null,
      tolerances,
    });
  }

  const actual = toActual(row);
  const planned = buildPlannedWorkout(workout, actual.date);
  const adherence = assessWorkout(planned, actual, tolerances);
  const segments = segmentReportFor(workout, toLaps(row.laps), tolerances.paceSec);

  return buildVerdict({
    activityId: row.id,
    athleteId: row.athlete_id,
    adherence,
    segments,
    tolerances,
    workoutName: workout.name,
  });
}

/**
 * Verdicts for many runs at once, from stored matches only.
 *
 * Returns a verdict for every id that named a real activity row — `unplanned`
 * for the ones with no match, which is the answer the UI shows rather than
 * silently omitting the run.
 */
export async function resolveExecutionSummaries(
  supabase: SupabaseServer,
  activityIds: string[],
  tolerances: AdherenceTolerances,
): Promise<ExecutionSummary[]> {
  if (activityIds.length === 0) return [];

  const { data: activityRows, error: activityError } = await supabase
    .from('athlete_activities')
    .select(ACTIVITY_SELECT)
    .in('id', activityIds);
  if (activityError) throw activityError;
  const activities = (activityRows || []) as unknown as ActivityRow[];
  if (activities.length === 0) return [];

  // activity_plan_matches (migration 054) may not be applied — then nothing is
  // matched and every run comes back `unplanned`, which is honest and renders.
  let matches: Array<{ activity_id: string; weekly_plan_id: string; workout_key: string; group_number: number }> = [];
  const matchResult = await supabase
    .from('activity_plan_matches')
    .select('activity_id, weekly_plan_id, workout_key, group_number')
    .in('activity_id', activities.map((row) => row.id));
  if (matchResult.error) {
    if (!isMissingMatchesTable(matchResult.error)) throw matchResult.error;
  } else {
    matches = matchResult.data || [];
  }

  const planIds = [...new Set(matches.map((match) => match.weekly_plan_id))];
  const plansById = new Map<string, unknown>();
  if (planIds.length) {
    const { data: planRows, error: planError } = await supabase
      .from('weekly_plans')
      .select('id, parsed_workouts')
      .in('id', planIds);
    if (planError) throw planError;
    for (const plan of planRows || []) plansById.set(plan.id, plan.parsed_workouts);
  }

  const matchByActivity = new Map(matches.map((match) => [match.activity_id, match]));
  // One plan is shared by everyone in a lane, so the flatten-and-normalize pass
  // is cached per (plan, lane) instead of run once per card.
  const workoutsCache = new Map<string, ParsedWorkout[]>();
  const workoutsFor = (planId: string, groupNumber: number): ParsedWorkout[] => {
    const key = `${planId}:${groupNumber}`;
    const cached = workoutsCache.get(key);
    if (cached) return cached;
    const plan = workoutPlanForGroup(plansById.get(planId), groupNumber);
    const workouts = plan?.workouts || [];
    workoutsCache.set(key, workouts);
    return workouts;
  };

  return activities.map((row) => {
    const match = matchByActivity.get(row.id);
    const workout = match
      ? workoutsFor(match.weekly_plan_id, match.group_number)
        .find((candidate) => candidate.workoutKey === match.workout_key) ?? null
      : null;
    return toExecutionSummary(verdictFor(row, workout, tolerances));
  });
}

/**
 * The full verdict for one run — metric rows and per-rep pace verdicts included.
 *
 * Unlike the batch path this WILL run the matcher (via `ensureMatchedWorkout`)
 * when nothing is stored, because the athlete is looking at this one run right
 * now and "no plan" is a much worse answer than a slower response.
 */
export async function resolveExecutionVerdict(
  supabase: SupabaseServer,
  activityId: string,
  tolerances: AdherenceTolerances,
): Promise<ExecutionVerdict | null> {
  const { data, error } = await supabase
    .from('athlete_activities')
    .select(ACTIVITY_SELECT)
    .eq('id', activityId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as ActivityRow;
  const matched = await ensureMatchedWorkout(supabase, row.id, row.athlete_id);
  return verdictFor(row, matched?.workout ?? null, tolerances);
}
