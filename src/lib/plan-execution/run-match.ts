import type { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

type SupabaseServer = ReturnType<typeof createServerClient>;

export interface RunMatch {
  workoutKey: string;
  groupNumber: number | null;
  /** The pack the runner said they ran with (migration 221), else null. */
  ranLane: 1 | 2 | 3 | null;
}

const asLane = (v: unknown): 1 | 2 | 3 | null => (v === 1 || v === 2 || v === 3 ? v : null);

/**
 * The stored plan match for one run, or null when there is none (or the table isn't
 * there). Falls back to the pre-221 shape when `ran_lane` hasn't been pasted in yet.
 */
export async function readRunMatch(supabase: SupabaseServer, activityId: string): Promise<RunMatch | null> {
  let res = await supabase.from('activity_plan_matches')
    .select('workout_key, group_number, ran_lane').eq('activity_id', activityId).maybeSingle();
  if (res.error && isMissingColumn(res.error, 'ran_lane')) {
    res = await supabase.from('activity_plan_matches')
      .select('workout_key, group_number').eq('activity_id', activityId).maybeSingle() as typeof res;
  }
  if (res.error || !res.data) return null;
  const row = res.data as { workout_key: string; group_number: number | null; ran_lane?: number | null };
  return { workoutKey: row.workout_key, groupNumber: row.group_number ?? null, ranLane: asLane(row.ran_lane) };
}

/** Batch form for the feed: activity id → match. Same fallback. */
export async function readRunMatches(supabase: SupabaseServer, activityIds: string[]): Promise<Map<string, RunMatch>> {
  const out = new Map<string, RunMatch>();
  if (!activityIds.length) return out;
  let res = await supabase.from('activity_plan_matches')
    .select('activity_id, workout_key, group_number, ran_lane').in('activity_id', activityIds);
  if (res.error && isMissingColumn(res.error, 'ran_lane')) {
    res = await supabase.from('activity_plan_matches')
      .select('activity_id, workout_key, group_number').in('activity_id', activityIds) as typeof res;
  }
  if (res.error) return out;
  for (const row of (res.data || []) as Array<{ activity_id: string; workout_key: string; group_number: number | null; ran_lane?: number | null }>) {
    out.set(row.activity_id, { workoutKey: row.workout_key, groupNumber: row.group_number ?? null, ranLane: asLane(row.ran_lane) });
  }
  return out;
}
