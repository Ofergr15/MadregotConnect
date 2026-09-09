import { createServerClient } from '@/lib/supabase/server';

const WINDOW_MS = 15 * 60 * 1000;
const DISTANCE_TOLERANCE = 0.1; // 10%

/**
 * How much of the shorter recording has to sit inside the longer one before two
 * rows can be called the same physical run.
 *
 * Start time plus distance is not enough, and the data says so. Measured
 * 2026-09-09: an athlete ran 6 × 2 km reps, logged as six separate activities
 * 9-10 minutes apart, ~430 s each — every consecutive pair is inside the
 * 15-minute window AND within 1% on distance. On start time and distance alone
 * they are six copies of one run; they are six real reps, and a dedupe that
 * merged them would silently delete five of an athlete's intervals.
 *
 * What actually separates the two cases is whether the recordings cover the same
 * wall clock. Two devices recording one run overlap almost completely (Shalev
 * Bahalul, same day: 99%). Reps are sequential and never overlap at all.
 */
const MIN_OVERLAP = 0.8;

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
  durationSeconds?: number | null,
): Promise<boolean> {
  return (
    (await findCrossSourceDuplicate(supabase, athleteId, startTimeLocal, distanceMeters, durationSeconds)) !== null
  );
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
  durationSeconds?: number | null,
): Promise<StoredTwin | null> {
  const start = new Date(startTimeLocal).getTime();
  if (Number.isNaN(start)) return null;
  // `duration` is selected for the overlap test — without it a set of reps 9
  // minutes apart at the same distance reads as one run copied several times.
  const { data } = await supabase
    .from('athlete_activities')
    .select('id, source, start_time, distance, duration')
    .eq('athlete_id', athleteId)
    .gte('start_time', new Date(start - WINDOW_MS).toISOString())
    .lte('start_time', new Date(start + WINDOW_MS).toISOString());

  return findStoredMatch((data || []) as StoredTwin[], startTimeLocal, distanceMeters, durationSeconds);
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

/**
 * What this comparison needs off a row, and nothing else.
 *
 * `duration` is optional because rows and importers that don't carry it still have
 * to get an answer — see runsOverlapEnough for what happens when it is missing.
 */
export type StoredActivity = {
  start_time: string | null;
  distance: number | null;
  duration?: number | null;
};

/**
 * Do these two recordings cover the same stretch of wall clock?
 *
 * The question start-time-plus-distance cannot answer. Returns true when the
 * shorter recording is at least MIN_OVERLAP inside the longer one.
 *
 * **Unknown duration means yes.** Without a second duration there is nothing to
 * overlap, and answering "no" would turn every duration-less row into a
 * guaranteed duplicate insert — the exact double-counting this module exists to
 * stop. So the overlap test can only ever make the match STRICTER, never looser,
 * and a row with no duration falls back to the window-and-distance verdict that
 * was in place before it existed.
 */
export function runsOverlapEnough(
  aStartMs: number,
  aDurationS: number | null | undefined,
  bStartMs: number,
  bDurationS: number | null | undefined,
): boolean {
  if (!aDurationS || !bDurationS || aDurationS <= 0 || bDurationS <= 0) return true;
  const aEnd = aStartMs + aDurationS * 1000;
  const bEnd = bStartMs + bDurationS * 1000;
  const overlapMs = Math.min(aEnd, bEnd) - Math.max(aStartMs, bStartMs);
  if (overlapMs <= 0) return false;
  const shorterMs = Math.min(aDurationS, bDurationS) * 1000;
  return overlapMs / shorterMs >= MIN_OVERLAP;
}

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
  durationSeconds?: number | null,
): boolean {
  return findStoredMatch(stored, startTimeLocal, distanceMeters, durationSeconds) !== null;
}

/**
 * The same verdict, handing back WHICH row matched. One implementation of the
 * comparison, so the boolean answer and the row answer can never drift apart.
 */
export function findStoredMatch<T extends StoredActivity>(
  stored: T[],
  startTimeLocal: string,
  distanceMeters: number,
  durationSeconds?: number | null,
): T | null {
  if (distanceMeters <= 0) return null;
  const start = new Date(startTimeLocal).getTime();
  if (Number.isNaN(start)) return null;
  return (
    stored.find((r) => {
      if (!r.distance || !r.start_time) return false;
      const t = new Date(r.start_time).getTime();
      if (Number.isNaN(t) || Math.abs(t - start) > WINDOW_MS) return false;
      if (Math.abs(r.distance - distanceMeters) / distanceMeters > DISTANCE_TOLERANCE) return false;
      // Last, and only ever narrowing: two runs that pass everything above and
      // still don't share the clock are consecutive reps, not two copies.
      return runsOverlapEnough(t, r.duration, start, durationSeconds);
    }) ?? null
  );
}

/**
 * One physical run, recorded twice by the SAME source.
 *
 * The dedupe above is cross-source by construction: the Garmin sync rules out its
 * own duplicates by `garmin_activity_id`, so two Garmin rows with two different
 * ids sail through both checks. Which is what happens when an athlete wears a
 * Garmin watch AND a Garmin band — both devices record the run, both upload to the
 * same account, and the club sees the same session twice at two different
 * distances (Shalev Bahalul, 2026-09-09: 16.1 km with a route and 14.7 km
 * without, 47 seconds apart, imported in the same batch).
 *
 * "In the same batch" is why this is in-memory rather than another query: neither
 * row existed when the other was classified, so nothing in the database could have
 * caught it.
 */
export type BatchCandidate = {
  activityId: number;
  startTimeLocal: string;
  distance: number;
  duration?: number | null;
  /** Present when the device had a GPS fix. See preferredRecording. */
  startLatitude?: number | null;
  lapCount?: number | null;
};

/**
 * Which of two recordings of one run to keep.
 *
 * GPS first, and it is not a close call: a wrist band without a fix derives
 * distance from cadence, which is how the same run came back as 14.7 km against
 * the watch's 16.1 km. Then laps — the device the athlete actually pressed the lap
 * button on is the one that knows the session's structure. Then the longer
 * recording, as the one less likely to have been stopped early. The activity id
 * settles the rest, so the outcome never depends on list order.
 */
export function preferredRecording<T extends BatchCandidate>(a: T, b: T): T {
  const gps = (x: T) => (x.startLatitude != null ? 1 : 0);
  if (gps(a) !== gps(b)) return gps(a) > gps(b) ? a : b;
  const laps = (x: T) => x.lapCount || 0;
  if (laps(a) !== laps(b)) return laps(a) > laps(b) ? a : b;
  const dur = (x: T) => x.duration || 0;
  if (dur(a) !== dur(b)) return dur(a) > dur(b) ? a : b;
  return a.activityId <= b.activityId ? a : b;
}

/**
 * Collapse a batch of same-source candidates to one row per physical run, keeping
 * the better recording of each pair.
 *
 * Order-independent: a batch is reduced to the same set whichever order the
 * provider listed it in, because every collision is resolved by
 * preferredRecording rather than by "first one wins".
 */
export function dedupeSameSourceBatch<T extends BatchCandidate>(
  list: T[],
): { keep: T[]; dropped: Array<{ kept: T; dropped: T }> } {
  const keep: T[] = [];
  const dropped: Array<{ kept: T; dropped: T }> = [];
  for (const candidate of list) {
    const held = keep.map((k) => ({
      start_time: k.startTimeLocal,
      distance: k.distance,
      duration: k.duration,
      ref: k,
    }));
    const twin = findStoredMatch(held, candidate.startTimeLocal, candidate.distance, candidate.duration);
    if (!twin) {
      keep.push(candidate);
      continue;
    }
    const winner = preferredRecording(twin.ref, candidate);
    if (winner === twin.ref) {
      dropped.push({ kept: twin.ref, dropped: candidate });
    } else {
      keep[keep.indexOf(twin.ref)] = candidate;
      dropped.push({ kept: candidate, dropped: twin.ref });
    }
  }
  return { keep, dropped };
}
