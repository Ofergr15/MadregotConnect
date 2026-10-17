import type { createServerClient } from '@/lib/supabase/server';
import { UNDEFINED_TABLE } from './overrides-store';

/**
 * Runs an athlete took out of their records (migration 146), read tolerantly like
 * the overrides: until 146 is pasted in, an absent table reads as "nothing excluded"
 * and every record shows exactly as it did before.
 *
 * activity id → the buckets it is excluded from; '*' means every bucket.
 */
export type PrExclusions = Map<string, Set<string>>;

type Supabase = ReturnType<typeof createServerClient>;

export const ALL_BUCKETS = '*';
/** PR_BUCKETS' keys — spelled out here so this module stays free of pr-buckets.ts, which imports it. */
const BUCKET_KEYS = ['5k', '10k', 'hm', 'fm'];

export function isExcluded(ex: PrExclusions | undefined, activityId: string | null | undefined, bucketKey: string): boolean {
  if (!ex || !activityId) return false;
  const set = ex.get(activityId);
  return !!set && (set.has(ALL_BUCKETS) || set.has(bucketKey));
}

function fold(rows: Array<{ activity_id: string; bucket_key: string }>): PrExclusions {
  const out: PrExclusions = new Map();
  for (const r of rows) {
    const set = out.get(r.activity_id) ?? new Set<string>();
    set.add(r.bucket_key);
    out.set(r.activity_id, set);
  }
  return out;
}

export async function readPrExclusions(supabase: Supabase, athleteId: string): Promise<PrExclusions> {
  const { data, error } = await supabase
    .from('athlete_pr_exclusions')
    .select('activity_id, bucket_key')
    .eq('athlete_id', athleteId);
  if (error || !data) return new Map();
  return fold(data as Array<{ activity_id: string; bucket_key: string }>);
}

/** Every athlete's at once, for the club board: athlete id → their exclusions. */
export async function readAllPrExclusions(supabase: Supabase): Promise<Map<string, PrExclusions>> {
  const { data, error } = await supabase
    .from('athlete_pr_exclusions')
    .select('athlete_id, activity_id, bucket_key');
  const out = new Map<string, PrExclusions>();
  if (error || !data) return out;
  const byAthlete = new Map<string, Array<{ activity_id: string; bucket_key: string }>>();
  for (const r of data as Array<{ athlete_id: string; activity_id: string; bucket_key: string }>) {
    const list = byAthlete.get(r.athlete_id) ?? [];
    list.push(r);
    byAthlete.set(r.athlete_id, list);
  }
  for (const [id, rows] of byAthlete) out.set(id, fold(rows));
  return out;
}

/** Whether the table exists — the write path says so instead of failing silently. */
export function tableMissing(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNDEFINED_TABLE;
}

export interface ExcludedRun { activityId: string; name: string | null; date: string }

/**
 * bucket → the runs taken out of it ('*' rows count for every bucket), newest first,
 * for the record screen's "runs that don't count" list.
 */
export function excludedRunsByBucket(
  acts: Array<{ id?: string; activity_name?: string | null; start_time: string }>,
  ex: PrExclusions,
): Record<string, ExcludedRun[]> {
  const out: Record<string, ExcludedRun[]> = {};
  if (ex.size === 0) return out;
  for (const a of acts) {
    if (!a.id) continue;
    const set = ex.get(a.id);
    if (!set) continue;
    for (const b of BUCKET_KEYS) {
      if (set.has(ALL_BUCKETS) || set.has(b)) (out[b] ??= []).push({ activityId: a.id, name: a.activity_name ?? null, date: a.start_time });
    }
  }
  return out;
}
