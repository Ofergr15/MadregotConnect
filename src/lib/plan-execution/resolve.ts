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
 * Laps follow the same split. The batch path reads only what's already stored
 * (the Strava sync writes them, and any earlier open of the run cached them). The
 * single-run path will fetch them from Garmin once and write them back — see
 * `ensureLaps`, and why a paced session with no laps is otherwise graded on
 * distance alone.
 */

import type { createServerClient } from '@/lib/supabase/server';
import type { ParsedWorkout } from '@/lib/ai/types';
import type { ActualActivity, AdherenceTolerances } from '@/lib/academy/adherence';
import { assessWorkout, buildPlannedWorkout } from '@/lib/academy/adherence';
import { flattenPlannedSteps, matchLapsToSteps, type Lap, type SegmentReport } from '@/lib/academy/segments';
import { GarminClient } from '@/lib/garmin/client';
import { ensureMatchedWorkout } from '@/lib/plans/matched-workout';
import { isMissingMatchesTable, workoutPlanForGroup } from '@/lib/plans/match-athlete-activities';
import { activityLocalDateStr } from '@/lib/utils';
import { hasStoredLaps, toLaps } from './laps';
import {
  buildVerdict,
  toExecutionSummary,
  type ExecutionSummary,
  type ExecutionVerdict,
} from './verdict';

type SupabaseServer = ReturnType<typeof createServerClient>;

/** Columns a verdict needs off the activity row. */
const ACTIVITY_SELECT = `
  id, athlete_id, garmin_activity_id, start_time, distance, duration, moving_duration,
  average_pace, activity_type, laps
`;

interface ActivityRow {
  id: string;
  athlete_id: string;
  garmin_activity_id: number | null;
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
 * The per-rep report for one run, or null when there are no laps to read.
 *
 * Exported for the academy roll-up, which reaches a verdict from the other
 * direction: it already holds the week's adherence rows from `assessWeek` and only
 * needs the reps. Sharing this is what keeps the coach's percentage identical to
 * the one the athlete sees on the run — two implementations of "which reps
 * counted" would eventually disagree, and the coach would be the last to know.
 */
export function segmentReportFor(workout: ParsedWorkout, laps: Lap[], paceSec: number): SegmentReport | null {
  if (laps.length === 0) return null;
  return matchLapsToSteps(flattenPlannedSteps(workout), laps, paceSec);
}

/** Did the coach actually prescribe paces here? Only then are laps worth a call. */
function prescribesPace(workout: ParsedWorkout): boolean {
  return flattenPlannedSteps(workout).some((segment) => !!segment.paceMin);
}

/**
 * The laps for one run, fetching them from Garmin the first time if need be.
 *
 * Without this the rep-by-rep breakdown only ever appeared on runs that some
 * OTHER screen had already enriched, and a paced session with no cached laps got
 * graded on distance alone — which is ~100% for anyone who finished the session,
 * however wrong their paces were. `api/academy/segments` has fetched laps
 * on demand for exactly this reason since it shipped; this mirrors it, including
 * the write-back, so the cost is paid once per run and every later reader (the
 * feed rings, the push) gets the reps for free.
 *
 * Deliberately narrow: only for a plan that prescribes paces, only when nobody
 * has looked yet, and any failure just means no reps. It never blocks a verdict.
 */
async function ensureLaps(
  supabase: SupabaseServer,
  row: ActivityRow,
  workout: ParsedWorkout,
): Promise<Lap[]> {
  if (hasStoredLaps(row.laps)) return toLaps(row.laps);
  if (!row.garmin_activity_id || !prescribesPace(workout)) return [];

  try {
    const { data: athlete } = await supabase
      .from('athletes')
      .select('garmin_auth')
      .eq('id', row.athlete_id)
      .maybeSingle();
    if (!athlete?.garmin_auth) return [];

    const client = new GarminClient(athlete.garmin_auth as never);
    const raw = await client.getActivitySplits(Number(row.garmin_activity_id));
    // One lap is the whole run relabelled — no more use than no laps at all.
    const laps = Array.isArray(raw) && raw.length > 1 ? toLaps(raw) : [];

    // Write back either way. `[]` is the "already asked" marker that stops every
    // future open of this run from paying for the same empty answer.
    await supabase
      .from('athlete_activities')
      .update({ laps })
      .eq('id', row.id)
      .then(() => {}, () => {});

    return laps;
  } catch {
    return [];
  }
}

/**
 * The one place a (run, planned workout) pair becomes a verdict.
 *
 * Laps are passed in rather than read off the row: the batch path uses only what
 * is already stored, while the single-run path may have just fetched them.
 */
function verdictFor(
  row: ActivityRow,
  workout: ParsedWorkout | null,
  tolerances: AdherenceTolerances,
  laps: Lap[],
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
  const segments = segmentReportFor(workout, laps, tolerances.paceSec);

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
    return toExecutionSummary(verdictFor(row, workout, tolerances, toLaps(row.laps)));
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
  const workout = matched?.workout ?? null;
  const laps = workout ? await ensureLaps(supabase, row, workout) : [];
  return verdictFor(row, workout, tolerances, laps);
}
