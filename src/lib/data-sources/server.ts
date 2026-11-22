/**
 * Database half of the native data-sources routes. Self-only: every function
 * takes the athlete id the ROUTE resolved from the JWT — never one from a request.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';
import { PROVIDER_HEALTH_COLUMNS_101 } from '@/lib/providers/health';
import { historyImportStatus, readHistoryCursors } from '@/lib/garmin/history-schedule';
import {
  CONNECTED_AT_COLUMNS_192,
  buildDataSourcesPayload,
  type AthleteSourceRow,
  type DataSourcesPayload,
  type HistoryProgress,
  type RecentRun,
} from './native';

type Db = SupabaseClient<any, any, any>;

/** Missing column (unapplied migration): Postgres 42703 / PostgREST PGRST204. */
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

const BASE = `garmin_auth, strava_auth, data_source, ${PROVIDER_HEALTH_COLUMNS_101}`;

export async function readSourceRow(db: Db, athleteId: string): Promise<AthleteSourceRow | null> {
  const withNew = await db.from('athletes').select(`${BASE}, ${CONNECTED_AT_COLUMNS_192}`).eq('id', athleteId).maybeSingle();
  if (!withNew.error) return (withNew.data as AthleteSourceRow) ?? null;
  if (!isMissingColumn(withNew.error)) throw withNew.error;
  const pre = await db.from('athletes').select(BASE).eq('id', athleteId).maybeSingle();
  if (pre.error) throw pre.error;
  return (pre.data as AthleteSourceRow) ?? null;
}

/**
 * The status the screen draws. Reads the blob columns to answer "is there one",
 * and nothing derived from them leaves except booleans and timestamps.
 */
export async function loadDataSourcesStatus(db: Db, athleteId: string): Promise<DataSourcesPayload | null> {
  const row = await readSourceRow(db, athleteId);
  if (!row) return null;

  const { data: runRows } = await db
    .from('athlete_activities')
    .select('id, activity_name, start_time, distance, duration, source')
    .eq('athlete_id', athleteId)
    .order('start_time', { ascending: false })
    .limit(3);
  const runs: RecentRun[] = (runRows ?? []).map((r: any) => ({
    id: String(r.id),
    name: r.activity_name ?? null,
    startTime: r.start_time,
    distanceM: r.distance ?? null,
    durationS: r.duration ?? null,
    source: r.source ?? null,
  }));

  let history: HistoryProgress = { state: 'none', imported: 0, reachedMonth: null };
  try {
    const cursors = await readHistoryCursors(db as any);
    const h = historyImportStatus(cursors[athleteId], !!row.garmin_auth);
    history = { state: h.state, imported: h.imported, reachedMonth: h.oldest ? h.oldest.slice(0, 7) : null };
  } catch {
    // History is a nicety on this screen; its absence must not blank the status.
  }
  return buildDataSourcesPayload(row, runs, history);
}

/**
 * Encrypt and write the Garmin credential. The blob is built and stored here and
 * nowhere else — the caller gets `true`, never the ciphertext.
 */
export async function storeGarminTokens(
  db: Db,
  athleteId: string,
  tokens: unknown,
  email: string,
  via: 'sso' | 'password',
): Promise<void> {
  const garmin_auth = encrypt({ email, tokens: tokens as Record<string, unknown>, lastAuth: new Date().toISOString() });
  const base = {
    garmin_auth,
    // A reconnect clears the old failure; the next sync stamps last_sync.
    garmin_auth_failed_at: null,
  };
  const now = new Date().toISOString();
  const first = await db.from('athletes').update({ ...base, garmin_connected_at: now, garmin_connected_via: via }).eq('id', athleteId);
  if (!first.error) return;
  if (!isMissingColumn(first.error)) throw first.error;
  const second = await db.from('athletes').update(base).eq('id', athleteId);
  if (second.error) throw second.error;
}

/** Runs kept + workouts still on the watch — the numbers the disconnect sheet shows. */
export async function disconnectCounts(db: Db, athleteId: string, today: string): Promise<{ runsKept: number; workoutsOnWatch: number }> {
  const [runs, wk] = await Promise.all([
    db.from('athlete_activities').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
    db.from('workout_deliveries').select('id', { count: 'exact', head: true })
      .eq('athlete_id', athleteId).eq('status', 'success').gte('workout_date', today),
  ]);
  return { runsKept: runs.count ?? 0, workoutsOnWatch: wk.count ?? 0 };
}
