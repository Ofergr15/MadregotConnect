import type { SupabaseClient } from '@supabase/supabase-js';
import { GarminClient } from './client';
import { lapsWorthStoring, narrowLaps, normalizeStoredLaps } from './laps';
import { narrowExecutedWorkout } from './executed-workout';
import { activitiesWithStreams, saveActivityStream } from './stream-store';

/**
 * Fetch the per-sample trace (and the laps) for runs already in the table.
 *
 * The sync now stores both for anything new, which leaves the history: 2281 rows
 * with no trace at all, and laps on 187 of them. That history is what the coach's
 * compliance table and every athlete's activity detail are grading right now, so
 * the backfill is not a nice-to-have — without it, "did you run the session" keeps
 * being answered from a whole-run average for every run already synced.
 *
 * Costs one to three Garmin requests per row (details; plus splits when the watch
 * marked laps; plus the step list when those laps turn out to be stamped with one),
 * serially, on the club's single unofficial API quota. Hence: newest first (recent
 * feedback is the feedback anyone reads), a `before` cursor so a sweep terminates, and
 * never re-fetching a row that already has a trace.
 */

export interface StreamBackfillOptions {
  /** Rows per call. Serial Garmin requests, so keep it inside maxDuration. */
  limit?: number;
  /** Only rows older than this `start_time` — the batch cursor. */
  before?: string | null;
  /** Only rows newer than this `start_time`, to scope a one-off run. */
  since?: string | null;
  /** One athlete instead of the club. */
  athleteId?: string | null;
  /** Re-fetch rows that already have a trace (e.g. after raising maxChartSize). */
  refetch?: boolean;
}

export interface StreamBackfillResult {
  scanned: number;
  streamsAdded: number;
  lapsAdded: number;
  /** Rows that turned out to be watch-driven and got their step list stored. */
  workoutsAdded: number;
  skipped: number;
  errors: Array<{ activityId: string; error: string }>;
  nextBefore: string | null;
  /** Set when migration 094 has not been applied — nothing was written. */
  unmigrated?: boolean;
}

interface Row {
  id: string;
  athlete_id: string;
  garmin_activity_id: number;
  start_time: string;
  distance: number | null;
  lap_count: number | null;
  laps: unknown[] | null;
}

/**
 * Store the step list for a run whose laps turned out to be stamped. Separate from the
 * laps write above because it must survive migration 095 being unapplied: the laps are
 * the older, more valuable half of the same repair, and losing them to a missing column
 * on the row beside them would be a poor trade.
 */
async function storeExecutedWorkout(
  supabase: SupabaseClient, activityId: string, workout: unknown,
): Promise<boolean> {
  const { error } = await supabase
    .from('athlete_activities')
    .update({ executed_workout: workout })
    .eq('id', activityId);
  return !error;
}

export async function backfillActivityStreams(
  supabase: SupabaseClient,
  options: StreamBackfillOptions = {},
): Promise<StreamBackfillResult> {
  const limit = Math.min(Math.max(options.limit || 25, 1), 60);
  const result: StreamBackfillResult = {
    scanned: 0, streamsAdded: 0, lapsAdded: 0, workoutsAdded: 0,
    skipped: 0, errors: [], nextBefore: null,
  };

  // Bail before spending any Garmin request if the table isn't there — the whole
  // pass would otherwise fetch a batch and discard every response.
  const probe = await supabase.from('activity_streams').select('activity_id').limit(1);
  if (probe.error) return { ...result, unmigrated: true };

  let query = supabase
    .from('athlete_activities')
    .select('id, athlete_id, garmin_activity_id, start_time, distance, lap_count, laps')
    // `> 0`: a Strava-sourced row stores the negated Strava id here, and Garmin has
    // never heard of it. Those runs need Strava's own streams, not this pass.
    .gt('garmin_activity_id', 0)
    .order('start_time', { ascending: false })
    .limit(limit);
  if (options.before) query = query.lt('start_time', options.before);
  if (options.since) query = query.gte('start_time', options.since);
  if (options.athleteId) query = query.eq('athlete_id', options.athleteId);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []) as Row[];
  result.scanned = rows.length;
  if (rows.length === 0) return result;

  // Oldest row this call saw, for the caller to pass back as `before`.
  result.nextBefore = rows[rows.length - 1].start_time;

  const already = options.refetch
    ? new Set<string>()
    : await activitiesWithStreams(supabase, rows.map(r => r.id));

  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, garmin_auth')
    .in('id', [...new Set(rows.map(r => r.athlete_id))])
    .not('garmin_auth', 'is', null);
  const authById = new Map((athletes || []).map(a => [a.id, a.garmin_auth]));
  const clients = new Map<string, GarminClient>();

  for (const row of rows) {
    if (already.has(row.id)) { result.skipped++; continue; }
    const auth = authById.get(row.athlete_id);
    if (!auth) { result.skipped++; continue; }

    try {
      let client = clients.get(row.athlete_id);
      if (!client) {
        client = new GarminClient(auth as never);
        clients.set(row.athlete_id, client);
      }

      const { stream } = await client.getActivityTrace(
        row.garmin_activity_id, row.distance ?? undefined);

      // Only ask for laps when the watch marked some and we don't already hold
      // them. `lap_count` is NULL on rows synced before it was captured, which is
      // "unknown", not "none" — worth the request, since laps are the only evidence
      // for reps on a run whose trace comes back downsampled.
      const hasStoredLaps = Array.isArray(row.laps) && row.laps.length > 1;
      const worthAsking = !hasStoredLaps && (row.lap_count == null || row.lap_count > 1);
      let lapDTOs: unknown[] = [];
      if (worthAsking) lapDTOs = await client.getActivitySplits(row.garmin_activity_id);
      const keepLaps = lapsWorthStoring(lapDTOs);

      const wrote = await saveActivityStream(supabase, {
        activityId: row.id,
        garminActivityId: row.garmin_activity_id,
        source: 'garmin',
        stream,
        laps: keepLaps ? lapDTOs : null,
      });
      if (wrote) result.streamsAdded++;

      // Mirror into the legacy column so the engines that already read it benefit
      // without waiting for the new one. Non-destructive: never overwrite laps a
      // row already has, and never write an empty array over them — a transient
      // Garmin failure must not erase evidence.
      const narrowed = keepLaps ? narrowLaps(lapDTOs) : [];
      if (keepLaps && !hasStoredLaps && narrowed.length > 1) {
        const { error: updateError } = await supabase
          .from('athlete_activities')
          .update({ laps: narrowed, lap_count: narrowed.length })
          .eq('id', row.id);
        if (!updateError) result.lapsAdded++;
      }

      // A stamped lap is the run telling us it was driven by a workout, and the step
      // list is the other half of that stamp — an index with nothing to index is not
      // evidence. Asked for only when a stamp is present, so the ~85% of history that
      // is plain running costs nothing here. Rows this pass already skipped (they have
      // a trace) are never re-fetched, so there is no repeat cost either.
      // `row.laps` is the narrowed shape already, so it reads through
      // normalizeStoredLaps; `lapDTOs` is Garmin's, so it reads through narrowLaps.
      const stamped = narrowed.some(l => l.wktStepIndex != null)
        || normalizeStoredLaps(row.laps).some(l => l.wktStepIndex != null);
      if (stamped) {
        const workout = narrowExecutedWorkout(
          await client.getActivityWorkout(row.garmin_activity_id));
        if (workout && await storeExecutedWorkout(supabase, row.id, workout)) {
          result.workoutsAdded++;
        }
      }
    } catch (err: unknown) {
      result.errors.push({
        activityId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
