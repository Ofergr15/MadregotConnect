import type { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

type SupabaseServer = ReturnType<typeof createServerClient>;

export interface RunMatch {
  workoutKey: string;
  groupNumber: number | null;
  /** The pack the runner said they ran with (migration 221), else null. */
  ranLane: 1 | 2 | 3 | null;
  /** The lane a surface already graded this run on (migration 227), else null. */
  resolvedLane: 1 | 2 | 3 | null;
  laneSource: string | null;
}

const asLane = (v: unknown): 1 | 2 | 3 | null => (v === 1 || v === 2 || v === 3 ? v : null);

// Newest shape first; each older one is the fallback while its migration is unpasted.
const SHAPES = [
  'workout_key, group_number, ran_lane, resolved_lane, lane_source',
  'workout_key, group_number, ran_lane',
  'workout_key, group_number',
];
const missingAny = (error: unknown) =>
  ['resolved_lane', 'lane_source', 'ran_lane'].some((c) => isMissingColumn(error as never, c));

type Row = { activity_id?: string; workout_key: string; group_number: number | null; ran_lane?: number | null; resolved_lane?: number | null; lane_source?: string | null };
const toMatch = (row: Row): RunMatch => ({
  workoutKey: row.workout_key,
  groupNumber: row.group_number ?? null,
  ranLane: asLane(row.ran_lane),
  resolvedLane: asLane(row.resolved_lane),
  laneSource: row.lane_source ?? null,
});

/**
 * The stored plan match for one run, or null when there is none (or the table isn't
 * there). Falls back to the pre-227 / pre-221 shapes when those aren't pasted in yet.
 */
export async function readRunMatch(supabase: SupabaseServer, activityId: string): Promise<RunMatch | null> {
  for (const cols of SHAPES) {
    const res = await supabase.from('activity_plan_matches').select(cols).eq('activity_id', activityId).maybeSingle();
    if (res.error && missingAny(res.error)) continue;
    if (res.error || !res.data) return null;
    return toMatch(res.data as unknown as Row);
  }
  return null;
}

/** Batch form for the feed: activity id → match. Same fallback. */
export async function readRunMatches(supabase: SupabaseServer, activityIds: string[]): Promise<Map<string, RunMatch>> {
  const out = new Map<string, RunMatch>();
  if (!activityIds.length) return out;
  for (const cols of SHAPES) {
    const res = await supabase.from('activity_plan_matches').select(`activity_id, ${cols}`).in('activity_id', activityIds);
    if (res.error && missingAny(res.error)) continue;
    if (res.error) return out;
    for (const row of (res.data || []) as unknown as Row[]) out.set(row.activity_id!, toMatch(row));
    return out;
  }
  return out;
}

/**
 * Save the lane a run was graded on (227) when it differs from what is stored, so the
 * next surface reads it instead of resolving again. Best-effort: a missing column or
 * a run with no match row writes nothing and changes no answer.
 */
export async function saveResolvedLane(
  supabase: SupabaseServer,
  activityId: string,
  resolved: { lane: number; source: string },
  stored: Pick<RunMatch, 'resolvedLane' | 'laneSource'> | null | undefined,
): Promise<void> {
  if (!stored) return; // no match row to write onto
  if (stored.resolvedLane === resolved.lane && stored.laneSource === resolved.source) return;
  try {
    await supabase.from('activity_plan_matches')
      .update({ resolved_lane: resolved.lane, lane_source: resolved.source })
      .eq('activity_id', activityId);
  } catch { /* best effort */ }
}
