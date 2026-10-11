/**
 * The reads and writes behind the load engine (lib/academy/load.ts prices; this fetches
 * and stores). Server-only.
 *
 * Migration 142 (`activity_loads`) ships AFTER this code, so every path feature-detects
 * it, the `hasTraineeCoachesTable` way:
 *   - with the table, a read first prices what is missing or stale (`ensureActivityLoads`,
 *     at most 300 a call, oldest first) and stores it, then reads the stored rows;
 *   - without it, the loads are computed in memory over the SAME 400 days the stored path
 *     keeps (`FALLBACK_DAYS = BACKFILL_DAYS`) and nothing is written. A shorter window seeds
 *     fitness at 0 a few months back and reads a long-history trainee several points
 *     fresher than the stored path (heavy: −7 vs −2), so the numbers would jump on the
 *     day 142 is pasted.
 * Under view-as (`write: false`) the missing rows are priced in memory and never stored.
 *
 * The ingest paths (Garmin sync, Strava webhook, Apple upload, manual) are untouched: a
 * new activity simply has no row, so the next read prices it, and the nightly sweep in
 * cron/academy-report covers trainees who never open the app.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, israelToday } from '@/lib/utils';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { pickPlan, planRowsFilter } from '@/lib/plans/scope';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { ParsedWorkout } from '@/lib/ai/types';
import { thresholdPaceSec } from './tests';
import { extractWorkouts, groupNumberFor } from './report';
import { loadLaneReferences } from './book-server';
import { planPaceBasis } from './plan-basis';
import {
  LOAD_VERSION, MAX_HR_DAYS, activityBreakdown, activityLoad, isRunType, maxHrOf, plannedLoad, restateOptions, restateSteps,
  shiftDate, thresholdOn,
  type ActivityBreakdown, type LoadActivity, type LoadSource, type TestPoint,
} from './load';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const ACTIVITY_LOADS_TABLE = 'activity_loads';

/** How far back a stored history reaches. */
export const BACKFILL_DAYS = 400;
/** Without migration 142: how far back the in-memory pricing reads laps — the stored path's window. */
export const FALLBACK_DAYS = BACKFILL_DAYS;
/** A screen prices at most this many rounds of MAX_NEW before it says "still computing". */
export const SCREEN_ROUNDS = 3;
/** Trainees priced side by side on a coach's board: a 41-trainee fan-out hung up sockets. */
export const FAN_OUT = 4;
/** At most this many activities priced per call (the rest wait for the next read or the sweep). */
export const MAX_NEW = 300;
/** Activities whose laps/splits are read in one query. */
export const PAGE = 100;
/** Rows per page when listing light columns or stored loads. */
const LIST_PAGE = 1000;
/** The resting HR of a run = the median of the 30 mornings before it. */
const RHR_DAYS = 30;
const RHR_MIN_MORNINGS = 3;

const LIGHT_COLUMNS = 'id, start_time, activity_type, max_hr, average_hr';
const HEAVY_COLUMNS = 'id, start_time, activity_type, distance, duration, moving_duration, average_hr, max_hr, laps, splits';

/** One priced activity, as stored or as computed. */
export interface ActivityLoadRow {
  activityId: string;
  athleteId: string;
  date: string;
  load: number | null;
  source: LoadSource;
  thresholdSec: number | null;
  basisTestDate: string | null;
  version: number;
}

// ── Feature detection ──────────────────────────────────────────────────────────────────

const tableSeen = new WeakMap<object, Promise<boolean>>();

/** A read that failed for a reason other than a missing table or column: worth one more try. */
export const isTransient = (error: unknown): boolean =>
  !!error && !isMissingTable(error) && !isMissingColumn(error);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * One PostgREST read, tried up to 3 times on a transient error (a socket hang-up, a
 * timeout). A missing table or column answers at once: that is schema, not the network.
 */
export async function withRetry<T extends { error: unknown }>(read: () => PromiseLike<T>, tries = 3): Promise<T> {
  let last: T | null = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      last = await read();
    } catch (err) {
      last = { data: null, error: err } as unknown as T;
    }
    if (!isTransient(last.error)) return last;
    if (i < tries - 1) await sleep(150 * (i + 1));
  }
  return last as T;
}

/** `fn` over `items`, at most `limit` at a time, results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Is migration 142 there? Memoised per client, i.e. per request. Only a missing table
 * says no: a probe that hung up is tried again, and if it keeps failing the read throws —
 * a network error must never quietly switch the screen to the in-memory path (that gave
 * C1 different numbers from one refresh to the next).
 */
export function hasActivityLoadsTable(supabase: Db): Promise<boolean> {
  const memo = tableSeen.get(supabase);
  if (memo) return memo;
  const probe = (async () => {
    const { error } = await withRetry(() => supabase.from(ACTIVITY_LOADS_TABLE).select('activity_id').limit(1));
    if (!error) return true;
    if (isMissingTable(error)) return false;
    tableSeen.delete(supabase);
    throw new LoadReadError('activity_loads probe', error);
  })();
  tableSeen.set(supabase, probe);
  return probe;
}

/** A load read that kept failing: the route answers an error instead of a different number. */
export class LoadReadError extends Error {
  constructor(what: string, public cause: unknown) {
    super(`${what} failed: ${(cause as { message?: string } | null)?.message ?? String(cause)}`);
    this.name = 'LoadReadError';
  }
}

// ── Inputs ─────────────────────────────────────────────────────────────────────────────

/**
 * Every usable test per athlete, oldest first: approved, not excluded, 30-minute — the
 * `loadTestBasis` rule in coach-tools-server.ts, so the load and the plan's paces stand
 * on the same test. `thresholdOn` picks the one valid on a given day.
 */
export async function loadTestsFor(supabase: Db, athleteIds: string[]): Promise<Record<string, TestPoint[]>> {
  const out: Record<string, TestPoint[]> = Object.fromEntries(athleteIds.map(id => [id, [] as TestPoint[]]));
  if (!athleteIds.length) return out;
  const read = (columns: string) => supabase
    .from('academy_tests')
    .select(columns)
    .in('athlete_id', athleteIds)
    .eq('protocol', '30min')
    .order('test_date', { ascending: true });
  let { data, error }: { data: any[] | null; error: unknown } = await read('athlete_id, test_date, duration_sec, distance_m, excluded_reason, status');
  if (error && isMissingColumn(error)) {
    ({ data, error } = await read('athlete_id, test_date, duration_sec, distance_m, excluded_reason'));
  }
  if (error || !data) return out;
  for (const row of data as any[]) {
    if (row.excluded_reason) continue;
    if ((row.status ?? 'approved') !== 'approved') continue;
    const pace = thresholdPaceSec({ durationSec: row.duration_sec, distanceM: row.distance_m });
    if (!pace || !(pace > 0) || !out[row.athlete_id]) continue;
    out[row.athlete_id].push({ date: String(row.test_date).slice(0, 10), thresholdSec: Math.round(pace) });
  }
  return out;
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Resting HR as of `date`: the median of the 30 mornings up to it. With fewer than 3 —
 * the wellness sweep only reaches back a week, so most old runs have none — the median of
 * the newest 30 stored mornings stands in. Null with no mornings at all.
 */
export function rhrOn(nights: Array<{ date: string; resting_hr: number | null }>, date: string): number | null {
  const from = shiftDate(date, -RHR_DAYS);
  const near = nights.filter(n => n.date >= from && n.date <= date && Number(n.resting_hr) > 0).map(n => Number(n.resting_hr));
  if (near.length >= RHR_MIN_MORNINGS) return median(near);
  const all = nights.filter(n => Number(n.resting_hr) > 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, RHR_DAYS);
  return all.length ? median(all.map(n => Number(n.resting_hr))) : null;
}

async function readNights(supabase: Db, athleteIds: string[], since: string): Promise<Map<string, Array<{ date: string; resting_hr: number | null }>>> {
  const out = new Map<string, Array<{ date: string; resting_hr: number | null }>>();
  if (!athleteIds.length) return out;
  try {
    // Paged: a coach's trainees over 430 days are far past PostgREST's 1,000-row cap.
    const { data, error } = await readAll<any>((from, to) => supabase
      .from('athlete_wellness')
      .select('athlete_id, date, resting_hr')
      .in('athlete_id', athleteIds)
      .gte('date', since)
      .order('date', { ascending: true })
      .order('athlete_id', { ascending: true })
      .range(from, to));
    if (error || !data) return out;
    for (const r of data as any[]) {
      const arr = out.get(r.athlete_id) || [];
      arr.push({ date: String(r.date).slice(0, 10), resting_hr: r.resting_hr ?? null });
      out.set(r.athlete_id, arr);
    }
  } catch { /* no wellness → no HR fallback */ }
  return out;
}

/**
 * Every page of a list query, `size` rows at a time, each page retried on a transient
 * error. The query must have a total order (a unique last sort key), or rows that tie
 * across a page boundary are read twice or not at all.
 */
export async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, size = LIST_PAGE): Promise<{ data: T[]; error: unknown }> {
  const all: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await withRetry(() => page(from, from + size - 1));
    if (error) return { data: all, error };
    const rows = data || [];
    all.push(...rows);
    if (rows.length < size) return { data: all, error: null };
  }
}

interface LightAct { id: string; start_time: string; activity_type: string | null; max_hr: number | null; average_hr?: number | null }

/**
 * Of the activities stored as `pace_avg`, the ones that now carry laps or per-km splits
 * (Strava sends laps after the run is first stored): their one-segment estimate is stale.
 * Two or more entries, so a single whole-run lap still reads as the average. Only the
 * second element of each array is selected, never the laps themselves.
 */
async function lapsArrived(supabase: Db, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await withRetry(() => supabase
      .from('athlete_activities')
      .select('id, lap2:laps->1, split2:splits->1')
      .in('id', ids.slice(i, i + 200)));
    if (error) {
      console.error('laps check for pace_avg loads failed:', error);
      return out;
    }
    for (const r of (data || []) as any[]) if (r.lap2 != null || r.split2 != null) out.add(String(r.id));
  }
  return out;
}

/**
 * Max HR for the HR fallback: as of TODAY, over the last 180 days, for every run priced
 * now. As of each run's own date, a new trainee's first two runs would have no max (it
 * needs 3 runs) and so no load, and "learning" would start two runs late (mockup 1ג
 * counts from the first run). A max moves rarely; when it does, only new rows see it.
 */
export function maxHrNow(
  acts: Array<{ start_time: string; max_hr: number | null; activity_type: string | null }>,
  today: string,
): number | null {
  return maxHrOf(acts.map(a => ({ date: activityLocalDateStr(a.start_time), maxHr: a.max_hr, type: a.activity_type })), today);
}

/** Price a set of full activity rows with the athlete's tests, mornings and max HR. */
function priceAll(
  athleteId: string,
  acts: Array<LoadActivity & { id: string }>,
  ctx: { tests: TestPoint[]; nights: Array<{ date: string; resting_hr: number | null }>; maxHr: number | null },
): ActivityLoadRow[] {
  return acts.map((a) => {
    const date = activityLocalDateStr(a.start_time);
    const r = activityLoad(a, {
      tests: ctx.tests,
      rhr: rhrOn(ctx.nights, date),
      maxHr: ctx.maxHr,
    });
    return {
      activityId: String(a.id), athleteId, date, load: r.load, source: r.source,
      thresholdSec: r.thresholdSec, basisTestDate: r.basisTestDate, version: LOAD_VERSION,
    };
  });
}

/** What the stale rule expects a row's basis to be: the test valid that day (none for a non-run). */
function expectedBasis(act: { start_time: string; activity_type: string | null }, tests: TestPoint[]): string | null {
  if (!isRunType(act.activity_type)) return null;
  return thresholdOn(activityLocalDateStr(act.start_time), tests)?.date ?? null;
}

/**
 * Is a stored row stale? Its formula is older, or the test valid on its date is not the
 * one it was priced against — a new test, an excluded one, or an HR row a test now covers
 * (stored with no basis, now there is one). A row from the stored `not_run` side only
 * goes stale with the formula.
 *
 * `lapsNow`: a `pace_avg` row whose activity now has laps or splits (`lapsArrived`).
 *
 * `hrNow`: the heart-rate basis (a max HR and a resting HR) exists today and this run
 * carries heart rate. A run stored as `none` before it existed — a new trainee's first two
 * runs, priced before a third gave a max — is priced again then, or "learning" would wait
 * on runs that were never going to be re-read.
 */
export function isStale(
  row: { formula_version?: number | null; basis_test_date?: string | null; source?: string | null },
  expected: string | null,
  hrNow = false,
  lapsNow = false,
): boolean {
  if ((Number(row.formula_version) || 0) < LOAD_VERSION) return true;
  if (row.source === 'not_run') return false;
  if (row.source === 'none' && hrNow) return true;
  // Priced as one average segment, and the laps (or splits) have arrived since.
  if (row.source === 'pace_avg' && lapsNow) return true;
  return (row.basis_test_date ? String(row.basis_test_date).slice(0, 10) : null) !== expected;
}

const toStoredRow = (r: ActivityLoadRow) => ({
  activity_id: r.activityId,
  athlete_id: r.athleteId,
  activity_date: r.date,
  load: r.load,
  source: r.source,
  threshold_sec: r.thresholdSec,
  basis_test_date: r.basisTestDate,
  formula_version: r.version,
  computed_at: new Date().toISOString(),
});

export interface EnsureResult {
  /** The rows priced by this call (stored when `wrote`). */
  rows: ActivityLoadRow[];
  /** Missing or stale rows left for the next call. */
  pending: number;
  wrote: number;
  /** False when migration 142 is not there (nothing was priced). */
  stored: boolean;
}

/**
 * Price the athlete's missing and stale activities (at most `maxNew`, oldest first) and
 * store them. Laps are read only for those, `PAGE` at a time. `write: false` (view-as)
 * prices the same rows and stores nothing.
 */
export async function ensureActivityLoads(
  supabase: Db,
  athleteId: string,
  opts: {
    maxNew?: number;
    write?: boolean;
    today?: string;
    tests?: TestPoint[];
    /**
     * Price the NEWEST missing first. The coach's board prices at most 100 per trainee on
     * one open; what is left over should be the oldest runs (whose weight on today's
     * numbers has all but decayed), not the last month's.
     */
    newestFirst?: boolean;
  } = {},
): Promise<EnsureResult> {
  const maxNew = opts.maxNew ?? MAX_NEW;
  const write = opts.write ?? true;
  const today = opts.today ?? israelToday();
  const since = shiftDate(today, -BACKFILL_DAYS);

  const [testsBy, listRes, existingRes, nightsBy] = await Promise.all([
    opts.tests ? Promise.resolve({ [athleteId]: opts.tests }) : loadTestsFor(supabase, [athleteId]),
    readAll<LightAct>((from, to) => supabase
      .from('athlete_activities')
      .select(LIGHT_COLUMNS)
      .eq('athlete_id', athleteId)
      .gte('start_time', `${since}T00:00:00Z`)
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    readAll<any>((from, to) => supabase
      .from(ACTIVITY_LOADS_TABLE)
      .select('activity_id, source, basis_test_date, formula_version')
      .eq('athlete_id', athleteId)
      .order('activity_id', { ascending: true })
      .range(from, to)),
    readNights(supabase, [athleteId], shiftDate(since, -RHR_DAYS)),
  ]);
  if (existingRes.error) {
    if (isMissingTable(existingRes.error)) return { rows: [], pending: 0, wrote: 0, stored: false };
    throw new LoadReadError('activity_loads read', existingRes.error);
  }
  if (listRes.error) throw new LoadReadError('activity list for loads', listRes.error);

  const tests = testsBy[athleteId] || [];
  const existing = new Map<string, any>(existingRes.data.map((r: any) => [String(r.activity_id), r]));
  const maxHr = maxHrNow(listRes.data, today);
  const nights = nightsBy.get(athleteId) || [];
  const hrBasis = maxHr != null && nights.some(n => Number(n.resting_hr) > 0);
  const averaged = listRes.data.filter(a => existing.get(String(a.id))?.source === 'pace_avg').map(a => String(a.id));
  const withLaps = averaged.length ? await lapsArrived(supabase, averaged) : new Set<string>();
  const todo = listRes.data.filter((a) => {
    const row = existing.get(String(a.id));
    return !row || isStale(row, expectedBasis(a, tests), hrBasis && Number(a.average_hr) > 0, withLaps.has(String(a.id)));
  });
  const batch = opts.newestFirst ? todo.slice(Math.max(0, todo.length - maxNew)) : todo.slice(0, maxNew);

  const rows: ActivityLoadRow[] = [];
  for (let i = 0; i < batch.length; i += PAGE) {
    const ids = batch.slice(i, i + PAGE).map(a => a.id);
    const { data, error } = await withRetry(() => supabase.from('athlete_activities').select(HEAVY_COLUMNS).in('id', ids));
    if (error) {
      console.error('activity laps for loads failed:', error);
      break;
    }
    rows.push(...priceAll(athleteId, (data || []) as any[], { tests, nights, maxHr }));
  }

  let wrote = 0;
  if (write && rows.length) {
    for (let i = 0; i < rows.length; i += PAGE) {
      const chunk = rows.slice(i, i + PAGE);
      const { error } = await supabase.from(ACTIVITY_LOADS_TABLE).upsert(chunk.map(toStoredRow), { onConflict: 'activity_id' });
      if (error) {
        console.error('activity_loads upsert failed:', error);
        break;
      }
      wrote += chunk.length;
    }
  }
  return { rows, pending: todo.length - rows.length, wrote, stored: true };
}

/** Day rows for the PMC: one per activity. */
export interface DailyRow {
  athleteId: string;
  activityId: string;
  date: string;
  load: number | null;
  source: LoadSource;
}

const toDaily = (r: ActivityLoadRow): DailyRow => ({
  athleteId: r.athleteId, activityId: r.activityId, date: r.date, load: r.load, source: r.source,
});

/**
 * Without migration 142: price the last `FALLBACK_DAYS` in memory, from the laps and
 * splits columns only (never activity_streams), and write nothing.
 */
async function computeInMemory(supabase: Db, athleteIds: string[], since: string, today: string): Promise<ActivityLoadRow[]> {
  const from = since > shiftDate(today, -FALLBACK_DAYS) ? since : shiftDate(today, -FALLBACK_DAYS);
  const [testsBy, nightsBy, actsRes] = await Promise.all([
    loadTestsFor(supabase, athleteIds),
    readNights(supabase, athleteIds, shiftDate(from, -RHR_DAYS)),
    readAll<any>((a, b) => supabase
      .from('athlete_activities')
      .select(`athlete_id, ${HEAVY_COLUMNS}`)
      .in('athlete_id', athleteIds)
      .gte('start_time', `${from}T00:00:00Z`)
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b), PAGE),
  ]);
  if (actsRes.error) throw new LoadReadError('activities for in-memory loads', actsRes.error);
  const out: ActivityLoadRow[] = [];
  for (const id of athleteIds) {
    const acts = actsRes.data.filter((a: any) => a.athlete_id === id);
    out.push(...priceAll(id, acts, { tests: testsBy[id] || [], nights: nightsBy.get(id) || [], maxHr: maxHrNow(acts, today) }));
  }
  return out;
}

/**
 * The per-activity loads of `athleteIds` since `since`, for the PMC. Stored rows when
 * migration 142 is there, else computed in memory over FALLBACK_DAYS (nothing written).
 */
export async function loadDailyRows(
  supabase: Db,
  athleteIds: string[],
  since: string,
  opts: { today?: string } = {},
): Promise<{ rows: DailyRow[]; stored: boolean }> {
  if (!athleteIds.length) return { rows: [], stored: true };
  const today = opts.today ?? israelToday();
  if (await hasActivityLoadsTable(supabase)) {
    const { data, error } = await readAll<any>((from, to) => supabase
      .from(ACTIVITY_LOADS_TABLE)
      .select('athlete_id, activity_id, activity_date, load, source')
      .in('athlete_id', athleteIds)
      .gte('activity_date', since)
      .order('activity_date', { ascending: true })
      .order('activity_id', { ascending: true })
      .range(from, to));
    if (!error) {
      return {
        stored: true,
        rows: data.map((r: any) => ({
          athleteId: String(r.athlete_id),
          activityId: String(r.activity_id),
          date: String(r.activity_date).slice(0, 10),
          load: r.load == null ? null : Number(r.load),
          source: r.source as LoadSource,
        })),
      };
    }
    // The table is there and the read kept failing: an error, never the in-memory numbers
    // (which would differ, and differ from the next refresh).
    if (!isMissingTable(error)) throw new LoadReadError('activity_loads read', error);
  }
  return { rows: (await computeInMemory(supabase, athleteIds, since, today)).map(toDaily), stored: false };
}

/**
 * One athlete's loads for a screen: price what is missing (stored unless `write` is off),
 * then read. A row priced by this call overrides the stored one, so view-as, a failed
 * upsert and the in-memory path all show the same numbers.
 */
export async function athleteLoads(
  supabase: Db,
  athleteId: string,
  opts: { since: string; write: boolean; today?: string },
): Promise<{ rows: DailyRow[]; tests: TestPoint[]; stored: boolean; pending: number }> {
  const today = opts.today ?? israelToday();
  const tests = (await loadTestsFor(supabase, [athleteId]))[athleteId] || [];
  if (await hasActivityLoadsTable(supabase)) {
    // A long history is priced in rounds (MAX_NEW each, oldest first) until nothing is
    // left, so the first open of a 380-run trainee is not read off its oldest 300 runs.
    // Under view-as nothing is stored, so one round prices the same rows each time:
    // the leftovers then stay `pending` and the screen says it is still computing.
    const priced: ActivityLoadRow[] = [];
    let ensured = await ensureActivityLoads(supabase, athleteId, { write: opts.write, today, tests });
    priced.push(...ensured.rows);
    for (let round = 1; opts.write && ensured.pending > 0 && ensured.wrote > 0 && round < SCREEN_ROUNDS; round += 1) {
      ensured = await ensureActivityLoads(supabase, athleteId, { write: true, today, tests });
      priced.push(...ensured.rows);
    }
    const { rows, stored } = await loadDailyRows(supabase, [athleteId], opts.since, { today });
    if (stored) {
      const fresh = new Map(priced.filter(r => r.date >= opts.since).map(r => [r.activityId, toDaily(r)]));
      const merged = rows.filter(r => !fresh.has(r.activityId)).concat([...fresh.values()]);
      merged.sort((a, b) => a.date.localeCompare(b.date));
      return { rows: merged, tests, stored: true, pending: ensured.pending };
    }
    return { rows, tests, stored: false, pending: 0 };
  }
  const rows = (await computeInMemory(supabase, [athleteId], opts.since, today)).map(toDaily);
  return { rows, tests, stored: false, pending: 0 };
}

export interface SweepResult {
  skipped?: 'no_table';
  athletes: number;
  priced: number;
  pending: number;
  timedOut: boolean;
}

/**
 * The nightly step: price every trainee's missing loads, so the coach's board is complete
 * for trainees who never open the app. Bounded by `budgetMs`; a failure on one athlete is
 * logged and skipped.
 */
export async function sweepActivityLoads(
  supabase: Db,
  opts: { athletes: string[]; budgetMs: number; now?: () => number },
): Promise<SweepResult> {
  const now = opts.now ?? Date.now;
  const result: SweepResult = { athletes: 0, priced: 0, pending: 0, timedOut: false };
  if (!(await hasActivityLoadsTable(supabase))) return { ...result, skipped: 'no_table' };
  const start = now();
  for (const id of opts.athletes) {
    if (now() - start >= opts.budgetMs) {
      result.timedOut = true;
      break;
    }
    try {
      // Until this athlete is settled or the budget is spent — a heavy history used to
      // stop at one call's MAX_NEW and leave its newest runs for tomorrow night.
      let r = await ensureActivityLoads(supabase, id, { write: true });
      result.priced += r.wrote;
      while (r.pending > 0 && r.wrote > 0 && now() - start < opts.budgetMs) {
        r = await ensureActivityLoads(supabase, id, { write: true });
        result.priced += r.wrote;
      }
      result.athletes += 1;
      result.pending += r.pending;
      if (r.pending > 0) result.timedOut = now() - start >= opts.budgetMs;
    } catch (err) {
      console.error('activity load sweep failed for', id, err);
    }
  }
  return result;
}

// ── Planned load (E2) ──────────────────────────────────────────────────────────────────

/**
 * The planned load of each of the given plan weeks (and of each day), over the trainee's
 * OWN plan row when there is one, else the club plan in their group's variant
 * (lib/plans/scope.ts — never another trainee's week). Priced at threshold `T`: the test
 * valid today, as the paces are. A club week's steps are in a squad lane's paces, so they
 * are restated to the trainee's first (lib/academy/plan-basis.ts, the week board's rule).
 * Optional sessions ("ערב - אופציה") are not counted.
 */
export async function plannedLoads(
  supabase: Db,
  athleteId: string,
  weekStarts: string[],
  T: number | null,
): Promise<{ byWeek: Record<string, number>; byDate: Record<string, number> }> {
  const byWeek: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  if (!T || !weekStarts.length) return { byWeek, byDate };
  const [athRes, groupsRes, plansRes, laneRefs] = await Promise.all([
    supabase.from('athletes').select('group_id').eq('id', athleteId).maybeSingle(),
    supabase.from('groups').select('id, name'),
    supabase
      .from('weekly_plans')
      .select('week_start_date, parsed_workouts, status, athlete_id, created_at')
      .eq('coach_id', COACH_ID)
      .or(planRowsFilter(athleteId))
      .in('week_start_date', weekStarts)
      .order('created_at', { ascending: true }),
    loadLaneReferences(supabase as never).catch(() => null),
  ]);
  if (plansRes.error || !plansRes.data) return { byWeek, byDate };
  const groupNames = new Map<string, string>(((groupsRes.data || []) as any[]).map(g => [g.id, g.name]));
  const groupId = (athRes.data as any)?.group_id ?? null;
  const groupNumber = groupNumberFor(groupId, groupNames);

  for (const weekStart of weekStarts) {
    const plan = pickPlan((plansRes.data as any[]).filter(p => String(p.week_start_date).slice(0, 10) === weekStart), athleteId);
    if (!plan) continue;
    const workouts: ParsedWorkout[] = extractWorkouts(plan.parsed_workouts, groupNumber);
    const { scale } = planPaceBasis({
      planAthleteId: plan.athlete_id, parsedWorkouts: plan.parsed_workouts,
      groupName: groupNames.get(groupId ?? '') ?? null, laneRefs, thresholdSec: T,
    });
    const opts = restateOptions(planEstimateOptions(workouts), scale);
    let week = 0;
    for (const w of workouts) {
      if (w.optional) continue;
      const load = plannedLoad(restateSteps(w.steps, scale), T, opts);
      if (!(load > 0)) continue;
      const date = shiftDate(weekStart, w.dayOfWeek);
      byDate[date] = (byDate[date] ?? 0) + load;
      week += load;
    }
    if (week > 0) byWeek[weekStart] = week;
  }
  return { byWeek, byDate };
}

/** The trainee's target race date from the characterization call, through their candidate row. */
export async function loadRaceDate(supabase: Db, athleteId: string): Promise<string | null> {
  try {
    const { data: cands, error } = await supabase.from('academy_candidates').select('id').eq('athlete_id', athleteId);
    if (error || !cands?.length) return null;
    const { data: rows, error: cErr } = await supabase
      .from('academy_characterizations')
      .select('target_race_date')
      .in('candidate_id', (cands as any[]).map(c => c.id));
    if (cErr || !rows?.length) return null;
    const dates = (rows as any[]).map(r => r.target_race_date).filter(Boolean).map((d: string) => String(d).slice(0, 10)).sort();
    return dates.length ? dates[dates.length - 1] : null;
  } catch {
    return null;
  }
}

// ── One activity's ⚡ (5ב, and the ⚡ row of screen 5) ──────────────────────────────────

export const ACTIVITY_LOAD_COLUMNS = 'id, athlete_id, start_time, activity_type, distance, duration, moving_duration, average_hr, max_hr, laps, splits';

/**
 * One activity priced with its parts, from the same tests and mornings
 * `ensureActivityLoads` reads, so the sheet and the stored row agree — and the stored
 * row kept in step with what the sheet shows (unless `write` is off: view-as).
 */
export async function activityLoadBreakdown(
  supabase: Db,
  athleteId: string,
  act: LoadActivity & { id: string },
  opts: { write: boolean; today?: string; tests?: TestPoint[] },
): Promise<ActivityBreakdown> {
  const date = activityLocalDateStr(act.start_time);
  const today = opts.today ?? israelToday();
  const [tests, nightsRes, historyRes] = await Promise.all([
    opts.tests ? Promise.resolve(opts.tests) : loadTestsFor(supabase, [athleteId]).then(t => t[athleteId] || []),
    supabase
      .from('athlete_wellness')
      .select('date, resting_hr')
      .eq('athlete_id', athleteId)
      .gte('date', shiftDate(today, -BACKFILL_DAYS - 30))
      .order('date', { ascending: true }),
    supabase
      .from('athlete_activities')
      .select('start_time, activity_type, max_hr')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${shiftDate(today, -MAX_HR_DAYS)}T00:00:00Z`),
  ]);
  const nights = ((nightsRes.error ? [] : nightsRes.data) || []).map((n: any) => ({ date: String(n.date).slice(0, 10), resting_hr: n.resting_hr ?? null }));
  const history = ((historyRes.error ? [] : historyRes.data) || []) as any[];
  const breakdown = activityBreakdown(act, { tests, rhr: rhrOn(nights, date), maxHr: maxHrNow(history, today) });

  if (opts.write && (await hasActivityLoadsTable(supabase))) {
    const { error } = await supabase.from(ACTIVITY_LOADS_TABLE).upsert({
      activity_id: act.id,
      athlete_id: athleteId,
      activity_date: date,
      load: breakdown.load,
      source: breakdown.source,
      threshold_sec: breakdown.thresholdSec,
      basis_test_date: breakdown.basisTestDate,
      formula_version: LOAD_VERSION,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'activity_id' });
    if (error) console.error('activity_loads upsert failed:', error);
  }
  return breakdown;
}
