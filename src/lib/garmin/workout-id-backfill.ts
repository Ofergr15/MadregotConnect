import type { createServerClient } from '@/lib/supabase/server';
import { GarminClient } from './client';
import { matchAthleteActivities } from '@/lib/plans/match-athlete-activities';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import type { GarminActivity } from './types';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * Fill `athlete_activities.garmin_workout_id` on rows that were synced before
 * migration 092 — or before the code that captures it shipped.
 *
 * The capture in the sync path is forward-looking: it only stamps rows at insert
 * time, and the enrichment pass in `PATCH /api/garmin/sync-activities` can't help
 * because it selects on `gps_points IS NULL` / `avg_cadence IS NULL` and so never
 * revisits a row that is already fully enriched. This pass is keyed on the column
 * itself, which is the only filter that reaches those rows.
 *
 * Deliberately cheap: the activity LIST row carries `workoutId` (verified live),
 * so one request per athlete covers up to 100 activities and no per-activity
 * detail or GPS call is needed. That is roughly a hundredth of the Garmin traffic
 * `mode=route` spends per row.
 */

const LIST_PAGE = 100;

/**
 * A row older than the athlete's last MAX_LIST_PAGES × LIST_PAGE activities can't
 * be reached this way. The cap exists so a full-history sweep terminates against
 * an athlete whose oldest NULL rows are Strava-era and will never appear in a
 * Garmin list at all.
 */
const MAX_LIST_PAGES = 10;

export type WorkoutIdBackfillOptions = {
  /** Rows per call. Garmin work is per athlete, not per row, so this can be large. */
  limit?: number;
  /** Only rows older than this `start_time` — the sweep cursor, as in `mode=route`. */
  before?: string | null;
  /** Only rows at or after this `start_time`. Scopes a one-off to a day or a week. */
  since?: string | null;
  /** One athlete instead of the whole club. */
  athleteId?: string | null;
  /** Re-run plan matching for the athletes whose rows changed. Default true. */
  rematch?: boolean;
};

export type FilledWorkoutId = {
  activityRowId: string;
  garminActivityId: number;
  athleteId: string;
  startTime: string;
  garminWorkoutId: string;
};

export type WorkoutIdBackfillResult = {
  scanned: number;
  filled: number;
  athletes: number;
  rematchedAthletes: number;
  /** Oldest `start_time` this call looked at — pass back as `before` to continue. */
  nextBefore: string | null;
  details: FilledWorkoutId[];
  errors?: string[];
  /** Set when migration 092 hasn't been applied; nothing was written. */
  unmigrated?: true;
};

type PendingRow = {
  id: string;
  garmin_activity_id: number;
  athlete_id: string;
  start_time: string;
};

/**
 * Which rows the athlete's activity list can actually answer for.
 *
 * A row whose list entry carries no `workoutId` is left NULL on purpose: "this run
 * was not started from a structured workout" is the normal case (every free run,
 * every Strava import), not a gap to keep retrying. Pure so the pairing is tested
 * without a Garmin account — see garminWorkoutIdBackfill.test.ts.
 */
export function pairListWorkoutIds(
  rows: PendingRow[],
  list: Map<number, Pick<GarminActivity, 'workoutId'>>,
): FilledWorkoutId[] {
  const filled: FilledWorkoutId[] = [];
  for (const row of rows) {
    const workoutId = list.get(row.garmin_activity_id)?.workoutId;
    if (!workoutId) continue;
    filled.push({
      activityRowId: row.id,
      garminActivityId: row.garmin_activity_id,
      athleteId: row.athlete_id,
      startTime: row.start_time,
      garminWorkoutId: workoutId,
    });
  }
  return filled;
}

/**
 * Local date of an activity, as a sortable `YYYY-MM-DD`.
 *
 * `athlete_activities.start_time` holds Garmin's `startTimeLocal` in a TIMESTAMPTZ
 * column (see CLAUDE.md), so its first ten characters and the list row's are the
 * same wall-clock date. Comparing those strings avoids parsing two timestamps that
 * disagree about what a timezone is.
 */
function localDate(timestamp: string): string {
  return (timestamp || '').slice(0, 10);
}

/**
 * Pull activity-list pages until every wanted activity is accounted for.
 *
 * Stops as soon as a page reaches further back than the oldest row we're looking
 * for: everything still missing after that point isn't in Garmin's list (a Strava
 * import, or a deleted activity) and more pages can't produce it.
 */
async function listCovering(
  client: GarminClient,
  rows: PendingRow[],
): Promise<Map<number, GarminActivity>> {
  const wanted = new Set(rows.map((row) => row.garmin_activity_id));
  const oldestWanted = rows.reduce(
    (oldest, row) => (localDate(row.start_time) < oldest ? localDate(row.start_time) : oldest),
    localDate(rows[0].start_time),
  );

  const index = new Map<number, GarminActivity>();
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const activities = await client.getActivities(page * LIST_PAGE, LIST_PAGE);
    if (activities.length === 0) break;
    for (const activity of activities) {
      if (wanted.has(activity.activityId)) index.set(activity.activityId, activity);
    }
    if (index.size === wanted.size) break;
    const oldestOnPage = activities.reduce(
      (oldest, a) => (localDate(a.startTimeLocal) < oldest ? localDate(a.startTimeLocal) : oldest),
      localDate(activities[0].startTimeLocal),
    );
    if (oldestOnPage < oldestWanted) break;
    if (activities.length < LIST_PAGE) break;
  }
  return index;
}

export async function backfillGarminWorkoutIds(
  supabase: SupabaseServer,
  options: WorkoutIdBackfillOptions = {},
): Promise<WorkoutIdBackfillResult> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const empty = {
    scanned: 0,
    filled: 0,
    athletes: 0,
    rematchedAthletes: 0,
    nextBefore: null,
    details: [] as FilledWorkoutId[],
  };

  let query = supabase
    .from('athlete_activities')
    .select('id, garmin_activity_id, athlete_id, start_time')
    // `> 0` for the same reason as the enrichment pass: a Strava-sourced row
    // stores the negated Strava id here, and Garmin has never heard of it.
    .gt('garmin_activity_id', 0)
    .is('garmin_workout_id', null)
    .order('start_time', { ascending: false })
    .limit(limit);
  if (options.before) query = query.lt('start_time', options.before);
  if (options.since) query = query.gte('start_time', options.since);
  if (options.athleteId) query = query.eq('athlete_id', options.athleteId);

  const { data, error } = await query;
  if (error) {
    // Migration 092 not applied: say so instead of failing as if Garmin broke.
    if (isMissingColumn(error, 'garmin_workout_id')) return { ...empty, unmigrated: true };
    throw error;
  }

  const rows = (data || []) as PendingRow[];
  if (rows.length === 0) return empty;

  const byAthlete = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const bucket = byAthlete.get(row.athlete_id);
    if (bucket) bucket.push(row);
    else byAthlete.set(row.athlete_id, [row]);
  }

  const { data: athletes, error: athleteError } = await supabase
    .from('athletes')
    .select('id, garmin_auth')
    .in('id', [...byAthlete.keys()])
    .not('garmin_auth', 'is', null);
  if (athleteError) throw athleteError;

  const errors: string[] = [];
  const details: FilledWorkoutId[] = [];
  const touched = new Set<string>();

  for (const athlete of athletes || []) {
    const pending = byAthlete.get(athlete.id);
    if (!pending || pending.length === 0) continue;

    let filledForAthlete: FilledWorkoutId[] = [];
    try {
      const client = new GarminClient(athlete.garmin_auth as any);
      filledForAthlete = pairListWorkoutIds(pending, await listCovering(client, pending));
    } catch (e: any) {
      errors.push(`${athlete.id}: ${e.message}`);
      continue;
    }

    for (const fill of filledForAthlete) {
      const { error: updateError } = await supabase
        .from('athlete_activities')
        .update({ garmin_workout_id: fill.garminWorkoutId })
        .eq('id', fill.activityRowId);
      if (updateError) {
        errors.push(`${fill.garminActivityId}: ${updateError.message}`);
        continue;
      }
      details.push(fill);
      touched.add(fill.athleteId);
    }
  }

  // The id on its own changes nothing an athlete or coach can see — the exact
  // match, the "from watch" badge and `device_confirmed_at` all come from
  // matchAthleteActivities reading it. Re-run it for the athletes whose rows moved
  // so a backfill is self-contained; it rebuilds derived matches from scratch and
  // leaves manual ones alone, so running it again is safe.
  let rematchedAthletes = 0;
  if (options.rematch !== false) {
    for (const athleteId of touched) {
      try {
        await matchAthleteActivities(supabase, athleteId);
        rematchedAthletes++;
      } catch (e: any) {
        errors.push(`match ${athleteId}: ${e.message}`);
      }
    }
  }

  return {
    scanned: rows.length,
    filled: details.length,
    athletes: byAthlete.size,
    rematchedAthletes,
    // Rows come back newest-first, so the last one is the oldest this call saw.
    nextBefore: rows[rows.length - 1].start_time,
    details,
    errors: errors.length > 0 ? errors : undefined,
  };
}
