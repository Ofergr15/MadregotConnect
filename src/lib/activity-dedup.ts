import { createServerClient } from '@/lib/supabase/server';

const WINDOW_MS = 15 * 60 * 1000;
const DISTANCE_TOLERANCE = 0.1; // 10%

/**
 * True when this athlete already has a DIFFERENT-source row for what's
 * clearly the same physical run — same start time (within WINDOW_MS) and
 * matching distance (within DISTANCE_TOLERANCE). Needed because Garmin can
 * auto-export a run to Strava, and both garmin/sync-activities and
 * strava/sync-activities import independently, each only deduping within its
 * own id space (garmin_activity_id / strava_activity_id) — neither one alone
 * ever sees the other source's row for the same run. Left unchecked, every
 * such run gets counted twice everywhere athlete_activities rows are summed:
 * cumulative_distance badges, challenges, shoe mileage, and teammate-notify.
 *
 * Callers should only invoke this AFTER their own same-source existence
 * check already ruled out a same-source duplicate — any row this finds is,
 * by construction, from the other source.
 */
export async function hasCrossSourceDuplicate(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  startTimeLocal: string,
  distanceMeters: number,
): Promise<boolean> {
  const start = new Date(startTimeLocal).getTime();
  const { data } = await supabase
    .from('athlete_activities')
    .select('start_time, distance')
    .eq('athlete_id', athleteId)
    .gte('start_time', new Date(start - WINDOW_MS).toISOString())
    .lte('start_time', new Date(start + WINDOW_MS).toISOString());

  return matchesStoredActivity((data || []) as StoredActivity[], startTimeLocal, distanceMeters);
}

/** The `(start_time, distance)` pair this comparison needs, and nothing else. */
export type StoredActivity = { start_time: string | null; distance: number | null };

/**
 * The same verdict as `hasCrossSourceDuplicate`, against rows the caller ALREADY
 * holds — no query at all.
 *
 * This exists because the query above is per candidate activity, and that is
 * fine on the live sync path (a handful of new runs) and ruinous on a history
 * walk: a hundred list rows meant a hundred sequential round trips inside one
 * serverless invocation, which is most of what made the first history import
 * time out. One `select` per athlete, then this in memory, is the same answer for
 * a fraction of the wall clock.
 *
 * Deliberately shares WINDOW_MS and DISTANCE_TOLERANCE with the query version:
 * two copies of a fuzzy-match threshold is how the live path and the backfill
 * would come to disagree about whether a run is a duplicate.
 */
export function matchesStoredActivity(
  stored: StoredActivity[],
  startTimeLocal: string,
  distanceMeters: number,
): boolean {
  if (distanceMeters <= 0) return false;
  const start = new Date(startTimeLocal).getTime();
  if (Number.isNaN(start)) return false;
  return stored.some((r) => {
    if (!r.distance || !r.start_time) return false;
    const t = new Date(r.start_time).getTime();
    if (Number.isNaN(t) || Math.abs(t - start) > WINDOW_MS) return false;
    return Math.abs(r.distance - distanceMeters) / distanceMeters <= DISTANCE_TOLERANCE;
  });
}
