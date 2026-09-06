import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActivityStream, ParsedStream } from './streams';

/**
 * Reading and writing `activity_streams` (migration 094).
 *
 * Every write here is best-effort and silent on failure, following the same rule as
 * the rest of the Garmin sync: the trace is evidence for a verdict, and a run must
 * never fail to sync — no badge, no streak, no leaderboard entry — because its
 * evidence could not be stored. That includes the case where migration 094 has not
 * been applied yet, which is normal in this repo: migrations are run by hand in the
 * Supabase SQL editor, so deployed code always predates the schema for a while.
 */

/** 42P01 = undefined_table, PGRST205 = PostgREST hasn't got the table in its schema
 *  cache. Either way migration 094 isn't applied and there is nothing to log about
 *  it on every activity of every sync. */
const MISSING_TABLE = new Set(['42P01', 'PGRST205', 'PGRST204']);

const isMissingTable = (error: { code?: string; message?: string } | null) =>
  !!error && (MISSING_TABLE.has(error.code || '') || /activity_streams/i.test(error.message || ''));

export interface StreamRecord {
  activityId: string;
  garminActivityId?: number | string | null;
  source?: string;
  stream: ParsedStream | null;
  /** Garmin lapDTOs exactly as they arrived — see lib/garmin/laps.ts. */
  laps?: unknown[] | null;
}

/**
 * Store one activity's trace. Upsert, not insert: a backfill re-run and a
 * re-opened activity detail both legitimately arrive at an activity that already
 * has one, and the newer response is the better one (a wider `maxChartSize`, or
 * laps that had not been marked yet at first sync).
 *
 * Returns whether a row was written, so a backfill can report a real count.
 */
export async function saveActivityStream(
  supabase: SupabaseClient,
  record: StreamRecord,
): Promise<boolean> {
  const { stream, laps } = record;
  // Nothing worth a row: no trace and no laps. An activity with neither is a
  // treadmill run with no distance axis, or a Garmin response we could not read.
  if (!stream && !(laps && laps.length)) return false;

  const payload: Record<string, unknown> = {
    activity_id: record.activityId,
    garmin_activity_id: record.garminActivityId != null ? Number(record.garminActivityId) : null,
    source: record.source || 'garmin',
    sample_count: stream?.sampleCount ?? 0,
    interval_sec: stream?.intervalSec ?? null,
    metrics: stream?.metrics ?? [],
    // NOT NULL in the schema: laps alone are still worth a row, and `{}` says
    // "asked, no trace" rather than leaving the column meaningless.
    series: stream?.series ?? {},
    laps: laps && laps.length ? laps : null,
    unit_correction: stream?.unitCorrection ?? null,
    fetched_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('activity_streams')
    .upsert(payload, { onConflict: 'activity_id' });
  if (error && !isMissingTable(error)) {
    console.error('activity_streams write failed:', error.message);
  }
  return !error;
}

export interface LoadedStream {
  activityId: string;
  series: ActivityStream;
  sampleCount: number;
  intervalSec: number;
  metrics: string[];
  laps: unknown[] | null;
}

/** One activity's trace, or null when it has none (or the table isn't there yet). */
export async function loadActivityStream(
  supabase: SupabaseClient,
  activityId: string,
): Promise<LoadedStream | null> {
  const { data, error } = await supabase
    .from('activity_streams')
    .select('activity_id, series, sample_count, interval_sec, metrics, laps')
    .eq('activity_id', activityId)
    .maybeSingle();
  if (error || !data) return null;
  const series = (data.series || {}) as ActivityStream;
  if (!Array.isArray(series.t) || !Array.isArray(series.d) || series.t.length < 2) {
    // A laps-only row. Real, but not a trace — a caller asking for a trace must
    // not get two-sample arrays it will happily divide by.
    return null;
  }
  return {
    activityId: data.activity_id,
    series,
    sampleCount: data.sample_count ?? series.t.length,
    intervalSec: Number(data.interval_sec) || 0,
    metrics: data.metrics || [],
    laps: (data.laps as unknown[]) ?? null,
  };
}

/**
 * Which of these activities already have a trace. For a backfill, which walks
 * thousands of rows and must not re-fetch what it already has — and for the
 * grading path, which needs to know whether to ask Garmin at all.
 */
export async function activitiesWithStreams(
  supabase: SupabaseClient,
  activityIds: string[],
): Promise<Set<string>> {
  if (activityIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('activity_streams')
    .select('activity_id')
    .in('activity_id', activityIds);
  if (error) return new Set();
  return new Set((data || []).map(r => r.activity_id as string));
}
