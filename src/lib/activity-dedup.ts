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
  return (await findCrossSourceDuplicate(supabase, athleteId, startTimeLocal, distanceMeters)) !== null;
}

/**
 * The same query, returning the ROW rather than a yes/no — for a caller that has
 * something better to do with a twin than drop its own copy.
 *
 * The Garmin sync is that caller. Both sources describe the same run, but not
 * equally well: the watch knows where each lap ended, and Strava's export of it
 * does not, so a Strava-first import leaves the athlete looking at even
 * kilometre splits for a session they ran as intervals (reported 2026-09-08).
 * Which source wins was previously decided by which cron happened to run first.
 */
export async function findCrossSourceDuplicate(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  startTimeLocal: string,
  distanceMeters: number,
): Promise<StoredTwin | null> {
  const start = new Date(startTimeLocal).getTime();
  if (Number.isNaN(start)) return null;
  const { data } = await supabase
    .from('athlete_activities')
    .select('id, source, start_time, distance')
    .eq('athlete_id', athleteId)
    .gte('start_time', new Date(start - WINDOW_MS).toISOString())
    .lte('start_time', new Date(start + WINDOW_MS).toISOString());

  return findStoredMatch((data || []) as StoredTwin[], startTimeLocal, distanceMeters);
}

/** What the Garmin sync should do about a run it is holding. */
export type TwinVerdict = 'insert' | 'upgrade' | 'skip';

/**
 * The source-precedence rule, in one place.
 *
 * Garmin outranks Strava for the same physical run: the watch recorded the laps
 * and Strava's copy of it has only whole kilometres. There are exactly two
 * importers, so a twin that is not Strava's is this run already here from Garmin
 * under another activity id — overwriting it with itself buys nothing and would
 * churn the row (and anything watching it) for no change.
 */
export function twinVerdict(twin: StoredTwin | null): TwinVerdict {
  if (!twin) return 'insert';
  return twin.source === 'strava' ? 'upgrade' : 'skip';
}

/**
 * The freshly-built Garmin row, narrowed to what an UPGRADE may write.
 *
 * An insert and an upgrade are not the same write. An insert fills a blank row, so
 * every field is worth setting, including the nulls. An upgrade lands on a row
 * Strava already populated — so a field Garmin doesn't report is an erasure, not an
 * update, and the run comes out of the "upgrade" poorer than it went in. Four
 * concrete ways that happened:
 *
 *  - **`calories`.** Garmin's LIST row never carries it; Strava's detail endpoint
 *    does. Written as `null`, the upgrade deletes the only copy.
 *  - **`shoe_id`.** The insert path uses `athlete.active_shoe_id`, which is the
 *    shoe the athlete is wearing NOW. Upgrades run over history (a Strava-imported
 *    run stays eligible until Garmin's copy lands), so this moves a month-old run
 *    onto today's pair — and `checkShoeAlert` sums every activity on the shoe, so
 *    the retirement warning fires against mileage that was never run in it.
 *  - **`activity_name`.** Athletes rename their own runs (`PATCH
 *    /api/feed/items/[id]`). Garmin's name is usually the better one, and it is
 *    still not ours to revert somebody's own words.
 *  - **`gps_points` / `has_polyline`.** An empty trace means the detail fetch
 *    failed, not that the run had no route. Writing it blanks a map the feed card
 *    is already drawing and re-fires migration 047's trigger to null
 *    `route_preview` with it.
 *
 * `athlete_id` goes too: it is already correct on the row being replaced, and an
 * upgrade is not the place to be able to move a run between athletes.
 *
 * `source` is set explicitly because the insert path leans on the column default.
 */
export function upgradePatch(row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'athlete_id' || key === 'activity_name' || key === 'shoe_id') continue;
    // "Garmin didn't report it" must never overwrite "Strava did".
    if (value === null || value === undefined) continue;
    // An empty points array is the same non-answer as a null one.
    if (key === 'gps_points' && Array.isArray(value) && value.length === 0) continue;
    patch[key] = value;
  }
  // Only meaningful alongside the points it describes.
  if (!('gps_points' in patch)) delete patch.has_polyline;
  patch.source = 'garmin';
  return patch;
}

/** The `(start_time, distance)` pair this comparison needs, and nothing else. */
export type StoredActivity = { start_time: string | null; distance: number | null };

/** A matched row, identified well enough to be updated in place. */
export type StoredTwin = StoredActivity & { id: string; source: string | null };

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
  return findStoredMatch(stored, startTimeLocal, distanceMeters) !== null;
}

/**
 * The same verdict, handing back WHICH row matched. One implementation of the
 * comparison, so the boolean answer and the row answer can never drift apart.
 */
export function findStoredMatch<T extends StoredActivity>(
  stored: T[],
  startTimeLocal: string,
  distanceMeters: number,
): T | null {
  if (distanceMeters <= 0) return null;
  const start = new Date(startTimeLocal).getTime();
  if (Number.isNaN(start)) return null;
  return (
    stored.find((r) => {
      if (!r.distance || !r.start_time) return false;
      const t = new Date(r.start_time).getTime();
      if (Number.isNaN(t) || Math.abs(t - start) > WINDOW_MS) return false;
      return Math.abs(r.distance - distanceMeters) / distanceMeters <= DISTANCE_TOLERANCE;
    }) ?? null
  );
}
