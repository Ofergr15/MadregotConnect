import type { createServerClient } from '@/lib/supabase/server';
import { GarminClient } from './client';
import { mapActivityDetail } from './activity-detail';
import { hasCrossSourceDuplicate } from '@/lib/activity-dedup';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { matchAthleteActivities } from '@/lib/plans/match-athlete-activities';
import { isMissingColumn, withoutColumns } from '@/lib/supabase/schema-drift';
import type { GarminActivity } from './types';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * Import an athlete's Garmin history from BEFORE the day they connected.
 *
 * ── THE GAP THIS EXISTS TO CLOSE ────────────────────────────────────────────
 * `POST /api/garmin/sync-activities` calls `client.getActivities(0, 100)` — page
 * zero, one hundred rows, no pagination — and nothing else in the app has ever
 * asked Garmin for an older page. So an athlete's entire visible history is
 * whichever hundred activities happened to be their most recent on the day they
 * connected, and the routine sync only ever adds to the top of it.
 *
 * The depth that buys is inversely proportional to how much someone trains,
 * which is the opposite of what anyone would guess. Measured on the club's own
 * first-sync insert batches: the athlete who runs twice a day got 52 days of
 * history out of his hundred rows, while a once-a-day athlete got 152 and one
 * who logs three or four runs a week got 178. The heaviest trainers have the
 * shortest past.
 *
 * What that does to the PR card is the visible symptom, and it hits the LONGEST
 * bucket hardest: a marathon is a rare event, so it is the personal best most
 * likely to sit outside a 52-day window. One athlete's displayed marathon best
 * was a July training run of 42.2 km at 145 bpm, because it was the only
 * marathon-distance effort inside his window at all, while every teammate's came
 * from a named race. Nothing was computed wrongly — `computeDistanceBests`
 * returns exactly the right answer for the rows it is given. The rows were the
 * problem.
 *
 * ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 * List rows only: no `getActivityFull`, no `getActivityGpsPoints`. One request
 * per hundred activities instead of two per activity — the difference between a
 * few dozen Garmin calls to import a club's history and something on the order
 * of ten thousand, which would be an abuse of an account credential. The list
 * row is rich enough for everything a PR, a total or a badge reads (distance,
 * duration, HR, cadence, stride, lap count, location), so `mapActivityDetail` is
 * handed `null` for the detail and fills the scalars from the list. Routes and
 * laps are left NULL on purpose, which is precisely what makes
 * `PATCH ?mode=route` (selecting on `gps_points IS NULL`) pick these rows up on
 * its own schedule. An old run gets its map later; it does not have to wait for
 * one to count.
 *
 * SILENT by construction. Every side effect the live sync fires per new activity
 * is suppressed here — no teammate pushes, no post-workout feedback nudge, no
 * "customize your post" sheet, no per-row challenge check, no shoe attribution.
 * Importing a March run is a correction to the record, not news: an athlete with
 * three hundred old activities would otherwise be pushed three hundred times,
 * and their squad along with them.
 *
 * `shoe_id` is left NULL for the same reason it is set on the live path. The
 * athlete's CURRENT shoe did not run their March sessions, and stamping it would
 * silently add hundreds of kilometres to a shoe's mileage — and fire the
 * replace-your-shoes alert off distance it never covered.
 *
 * Badges ARE evaluated, once per athlete after their walk finishes rather than
 * per row. A first-marathon badge earned in March is a true fact about the
 * athlete that the club simply had no record of, and `checkAndAwardBadges` skips
 * anything already awarded, so this cannot re-award or double-post.
 *
 * Resumable, because Vercel gives the cron sixty seconds: `maxPages` bounds the
 * Garmin calls per call and `nextPage` says where to pick up. See
 * `workout-id-backfill.ts`, whose paging this mirrors.
 */

/** Garmin's own list page size, and the largest it honours. */
const LIST_PAGE = 100;

/**
 * How far each page advances. Ten rows SHORT of a full page, on purpose.
 *
 * Garmin pages by offset into a newest-first list, so an activity synced while a
 * walk is in progress shifts every subsequent offset down by one and a row falls
 * through the crack between two pages — permanently, since nothing revisits it.
 * Overlapping absorbs up to ten new activities per walk, and an overlap costs
 * nothing at all: `garmin_activity_id` already de-duplicates, so a row seen
 * twice is simply skipped the second time.
 */
const PAGE_STRIDE = LIST_PAGE - 10;

/**
 * Hard ceiling on how deep a single athlete's history is walked, across all
 * calls. Fifty pages is ~4,500 activities — a decade of twice-a-day running,
 * and far more than Garmin's own list will serve. It exists so a bug in the
 * termination check costs a bounded number of requests rather than an unbounded
 * one against the club's shared credential.
 */
const MAX_PAGE = 50;

/**
 * Which activity types count as a run.
 *
 * Copied from the live sync path verbatim, including the trailing
 * `includes('running')` catch-all, so history and new activity agree about what
 * a run is. A backfill that admitted a broader set would show an athlete
 * activities in their past that the same watch would not create today.
 */
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'street_running', 'indoor_running'];

const isRun = (a: GarminActivity) =>
  RUN_TYPES.includes(a.activityType) || a.activityType.includes('running');

export type HistoryBackfillOptions = {
  /** One athlete instead of every athlete with Garmin auth. */
  athleteId?: string | null;
  /** Garmin list pages per athlete this call. Default 3; the cron's page budget. */
  maxPages?: number;
  /** Where to resume, from a previous result's `nextPage`. Default 1. */
  fromPage?: number;
  /**
   * Evaluate badges once per athlete whose history grew. Default true; set false
   * for a dry-ish first pass where only the row count matters.
   */
  awardBadges?: boolean;
  /**
   * Re-run plan matching for the athletes whose rows changed. Default false —
   * unlike the workout-id backfill, imported history predates every published
   * plan, so there is normally nothing for it to match.
   */
  rematch?: boolean;
};

export type AthleteHistoryResult = {
  athleteId: string;
  name: string | null;
  /** Run rows inserted. */
  imported: number;
  /** List rows read from Garmin. */
  scanned: number;
  pagesFetched: number;
  /** Oldest `start_time` now stored, after this call. */
  oldestStored: string | null;
  /**
   * Page to resume from, or null when this athlete's history is exhausted —
   * Garmin returned a short page, so there is nothing older to ask for.
   */
  nextPage: number | null;
  error?: string;
};

export type HistoryBackfillResult = {
  athletes: AthleteHistoryResult[];
  imported: number;
  /** True while any athlete still has a `nextPage` — call again to continue. */
  more: boolean;
};

/** Sortable local date, as in `workout-id-backfill.ts` — see its `localDate`. */
const localDate = (timestamp: string): string => (timestamp || '').slice(0, 10);

/**
 * One athlete's history, for at most `maxPages` Garmin pages.
 *
 * Walks strictly older, and inserts only what is genuinely missing: rows already
 * known by `garmin_activity_id`, and rows Strava imported independently (the
 * same auto-export duplication `hasCrossSourceDuplicate` guards on the live
 * path) are both skipped. A page that yields nothing new is NOT a reason to
 * stop — the pages between "now" and the oldest stored row are all already known
 * by construction, so an early exit would never reach the history at all.
 */
async function backfillAthlete(
  supabase: SupabaseServer,
  athlete: { id: string; name: string | null; garmin_auth: unknown },
  options: HistoryBackfillOptions,
): Promise<AthleteHistoryResult> {
  const maxPages = Math.min(Math.max(options.maxPages ?? 3, 1), 20);
  const fromPage = Math.max(options.fromPage ?? 1, 1);
  const base: AthleteHistoryResult = {
    athleteId: athlete.id,
    name: athlete.name,
    imported: 0,
    scanned: 0,
    pagesFetched: 0,
    oldestStored: null,
    nextPage: null,
  };

  // Every Garmin id this athlete already has, in one read. The alternative — a
  // per-activity existence check — would be a round trip per list row, which on
  // a history walk is thousands of them.
  const { data: existingRows, error: existingError } = await supabase
    .from('athlete_activities')
    .select('garmin_activity_id')
    .eq('athlete_id', athlete.id);
  if (existingError) return { ...base, error: existingError.message };
  const existingIds = new Set(
    (existingRows || []).map((r: { garmin_activity_id: number | null }) => r.garmin_activity_id),
  );

  const client = new GarminClient(athlete.garmin_auth as never);
  let imported = 0;
  let scanned = 0;
  let pagesFetched = 0;
  let page = fromPage;
  let exhausted = false;

  for (let fetched = 0; fetched < maxPages && page <= MAX_PAGE; fetched++, page++) {
    let activities: GarminActivity[];
    try {
      activities = await client.getActivities(page * PAGE_STRIDE, LIST_PAGE);
    } catch (e) {
      return { ...base, imported, scanned, pagesFetched, nextPage: page, error: (e as Error).message };
    }
    pagesFetched++;
    if (!activities || activities.length === 0) {
      exhausted = true;
      break;
    }
    scanned += activities.length;

    const candidates = activities.filter((a) => isRun(a) && !existingIds.has(a.activityId) && a.distance > 0 && a.duration > 0);

    const rows: Record<string, unknown>[] = [];
    for (const a of candidates) {
      if (await hasCrossSourceDuplicate(supabase, athlete.id, a.startTimeLocal, a.distance)) continue;
      // Detail is `null`: no per-activity Garmin call. The mapper falls back to
      // the list row for every scalar, and `gps_points`/`has_polyline` are then
      // dropped so `PATCH ?mode=route` still sees this row as one needing a map.
      const { gps_points: _gps, has_polyline: _poly, ...scalars } = mapActivityDetail(null, a);
      rows.push({
        athlete_id: athlete.id,
        garmin_activity_id: a.activityId,
        activity_name: a.activityName,
        activity_type: a.activityType,
        start_time: a.startTimeLocal,
        distance: Math.round(a.distance),
        duration: Math.round(a.duration),
        average_pace: a.distance > 0 ? Math.round(a.duration / (a.distance / 1000)) : null,
        average_hr: a.averageHR,
        max_hr: a.maxHR,
        calories: a.calories || null,
        elevation_gain: a.elevationGain,
        // shoe_id deliberately absent — see the file comment.
        ...scalars,
      });
      // Guard the rest of THIS page against a Garmin list that repeats an id
      // across the overlap, and the next page against re-reading it.
      existingIds.add(a.activityId);
    }

    if (rows.length > 0) {
      const insert = (payload: Record<string, unknown>[]) =>
        supabase
          .from('athlete_activities')
          // Same upsert-ignore as the live path: two overlapping backfill ticks
          // for one athlete can each compute the same row as new from their own
          // `existingIds` snapshot, and a plain insert would fail the whole page
          // on the unique violation.
          .upsert(payload, { onConflict: 'athlete_id,garmin_activity_id', ignoreDuplicates: true })
          .select('id');

      let payload = rows;
      let { data: inserted, error: insertError } = await insert(payload);
      // One un-applied migration must not cost the whole import. Drops only the
      // column the error NAMES, as the live path does, so a database missing
      // migration 092 does not also lose everything after it.
      const optional = ['garmin_workout_id', 'perceived_rpe', 'perceived_feel'];
      const dropped: string[] = [];
      while (insertError && dropped.length < optional.length) {
        const drop = optional.find((c) => !dropped.includes(c) && isMissingColumn(insertError, c));
        if (!drop) break;
        dropped.push(drop);
        payload = withoutColumns(payload, [drop]) as Record<string, unknown>[];
        ({ data: inserted, error: insertError } = await insert(payload));
      }
      if (insertError) {
        return { ...base, imported, scanned, pagesFetched, nextPage: page, error: insertError.message };
      }
      imported += (inserted || []).length;
    }

    // A short page is Garmin saying there is nothing older. That — not "found
    // nothing new" — is the only honest terminator.
    if (activities.length < LIST_PAGE) {
      exhausted = true;
      break;
    }
  }

  const { data: oldest } = await supabase
    .from('athlete_activities')
    .select('start_time')
    .eq('athlete_id', athlete.id)
    .order('start_time', { ascending: true })
    .limit(1);

  return {
    ...base,
    imported,
    scanned,
    pagesFetched,
    oldestStored: (oldest || [])[0]?.start_time ?? null,
    nextPage: exhausted || page > MAX_PAGE ? null : page,
  };
}

/**
 * Import missing Garmin history for one athlete or the whole club.
 *
 * Best-effort per athlete: a revoked credential or a Garmin outage on one
 * account is recorded against that athlete and the walk continues, exactly as
 * the live sync treats a failed fetch.
 */
export async function backfillGarminHistory(
  supabase: SupabaseServer,
  options: HistoryBackfillOptions = {},
): Promise<HistoryBackfillResult> {
  let query = supabase
    .from('athletes')
    .select('id, name, garmin_auth')
    .not('garmin_auth', 'is', null);
  if (options.athleteId) query = query.eq('id', options.athleteId);

  const { data: athletes, error } = await query;
  if (error) throw error;

  const results: AthleteHistoryResult[] = [];
  for (const athlete of (athletes || []) as Array<{ id: string; name: string | null; garmin_auth: unknown }>) {
    if (!athlete.garmin_auth) continue;
    const result = await backfillAthlete(supabase, athlete, options);
    results.push(result);

    if (result.imported > 0 && options.awardBadges !== false) {
      // Once per athlete, after their rows are in — not per row. Any badge this
      // finds was genuinely earned; the club just had no record of the run.
      try {
        await checkAndAwardBadges(athlete.id);
      } catch (e) {
        result.error = [result.error, `badges: ${(e as Error).message}`].filter(Boolean).join('; ');
      }
    }
    if (result.imported > 0 && options.rematch) {
      try {
        await matchAthleteActivities(supabase, athlete.id);
      } catch (e) {
        result.error = [result.error, `match: ${(e as Error).message}`].filter(Boolean).join('; ');
      }
    }
  }

  return {
    athletes: results,
    imported: results.reduce((sum, r) => sum + r.imported, 0),
    more: results.some((r) => r.nextPage != null),
  };
}
