/**
 * Repair geometry on Strava runs already stored without it.
 *
 * A Strava run's route arrives as `map.summary_polyline` on the activity *list*,
 * and until v2.39.21 the sync reduced it to a boolean and dropped the geometry.
 * v2.39.21 recovers it, but only inside POST /api/strava/sync-activities — which
 * is called only from a browser (the dashboard, profile and activities pages), so
 * a row is repaired only when that athlete personally opens the app.
 *
 * Measured on production 2026-09-04: 170 routeless rows, 154 of them belonging to
 * one athlete, so essentially the whole backlog was waiting on one person's next
 * login. Ten more belong to an athlete whose `data_source` is 'garmin', and the
 * sync filters on `data_source='strava'` — those could never have been reached by
 * any login at all. Hence this: a pass that repairs rows regardless of whose they
 * are or who is currently signed in.
 *
 * Its only caller today is the staff PATCH on /api/strava/sync-activities. It is
 * written to be safe on a schedule too — the cheapness is the point. Garmin's
 * equivalent backfill spends two requests per row; here the cost is a few page
 * requests per athlete however many rows get fixed, and **zero** requests once
 * there is nothing left to repair, because one indexed query answers that and
 * returns before any client is constructed. Wiring it into cron/sync (which is
 * deliberately Garmin-only today) would drain the backlog with no human involved
 * and then go quiet; that call is Ofer's, not made here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/encryption';
import { StravaClient, type StravaTokens } from './client';
import { getValidStravaToken } from './enrich';
import { routeFromSummaryPolyline } from './polyline';

/** Rows whose geometry could not be resolved, per athlete. */
export interface RouteBackfillAthleteResult {
  athleteId: string;
  name: string;
  /** Rows that got a real route. */
  repaired: number;
  /** Rows where Strava confirms there is no route, so has_polyline went false. */
  cleared: number;
  /** Rows Strava's list never returned — older than the pages walked, or deleted there. */
  unreachable: number;
  error?: string;
}

export interface RouteBackfillResult {
  /** Rows that needed repair when the pass started. */
  targets: number;
  repaired: number;
  cleared: number;
  unreachable: number;
  results: RouteBackfillAthleteResult[];
}

interface Target {
  id: string;
  athlete_id: string;
  strava_activity_id: number;
  start_time: string | null;
  has_polyline: boolean | null;
}

const DEFAULT_MAX_PAGES = 10;

export async function backfillStravaRoutes(
  supabase: SupabaseClient,
  options?: { athleteId?: string | null; maxPages?: number },
): Promise<RouteBackfillResult> {
  const maxPages = Math.min(Math.max(options?.maxPages || DEFAULT_MAX_PAGES, 1), 20);
  const empty: RouteBackfillResult = {
    targets: 0,
    repaired: 0,
    cleared: 0,
    unreachable: 0,
    results: [],
  };

  // Deliberately NOT selecting gps_points: the whole point is to find rows where
  // it is null, and on the rows that do have one it holds thousands of
  // coordinates. Selecting it to test it for null would pull megabytes.
  let targetQuery = supabase
    .from('athlete_activities')
    .select('id, athlete_id, strava_activity_id, start_time, has_polyline')
    .eq('source', 'strava')
    .is('gps_points', null)
    .not('strava_activity_id', 'is', null);
  if (options?.athleteId) targetQuery = targetQuery.eq('athlete_id', options.athleteId);
  const { data: targets, error: targetError } = await targetQuery.returns<Target[]>();
  if (targetError) throw targetError;
  // The quiet path once the backlog is drained: one indexed query, no Strava call.
  if (!targets?.length) return empty;

  // Group first, so each athlete's history is fetched once rather than per row.
  const byAthlete = new Map<string, Target[]>();
  for (const t of targets) {
    const rows = byAthlete.get(t.athlete_id);
    if (rows) rows.push(t);
    else byAthlete.set(t.athlete_id, [t]);
  }

  const { data: athletes, error: athError } = await supabase
    .from('athletes')
    .select('id, name, strava_auth')
    .in('id', [...byAthlete.keys()])
    .returns<Array<{ id: string; name: string; strava_auth: string | null }>>();
  if (athError) throw athError;

  const out: RouteBackfillResult = { ...empty, targets: targets.length, results: [] };

  for (const athlete of athletes || []) {
    const rows = byAthlete.get(athlete.id) || [];
    const fail = (error: string) => {
      out.unreachable += rows.length;
      out.results.push({
        athleteId: athlete.id,
        name: athlete.name,
        repaired: 0,
        cleared: 0,
        unreachable: rows.length,
        error,
      });
    };

    if (!athlete.strava_auth) {
      // A row with source='strava' whose athlete has since disconnected.
      fail('No Strava authorisation');
      continue;
    }

    try {
      const auth = decrypt(athlete.strava_auth) as StravaTokens;
      const token = await getValidStravaToken(supabase, athlete.id, auth);
      if (!token) {
        fail('Token refresh failed');
        continue;
      }

      // Page back only as far as the oldest row that actually needs repair,
      // rather than the sync's fixed 180 days: it keeps a small repair to a
      // single request, and lets a genuinely old backlog be reached at all.
      // A day of slack absorbs the skew between the stored local start_time and
      // Strava's epoch filter.
      const oldestMs = rows.reduce<number | null>((oldest, row) => {
        if (!row.start_time) return oldest;
        const ms = new Date(row.start_time).getTime();
        if (Number.isNaN(ms)) return oldest;
        return oldest === null || ms < oldest ? ms : oldest;
      }, null);
      const after = oldestMs === null ? undefined : Math.floor(oldestMs / 1000) - 24 * 60 * 60;
      // per_page 200 is Strava's maximum, so this is the fewest requests possible.
      const activities = await new StravaClient(token).getAllActivities({
        after,
        maxPages,
        perPage: 200,
      });

      // `has`, not the value: an activity present in the list with no
      // summary_polyline is a *confirmed* routeless run — a treadmill session or
      // a manual entry — which is a different answer from "not found", and only
      // one of the two justifies writing to the row.
      const polylineById = new Map<number, string | null | undefined>();
      for (const a of activities) polylineById.set(a.id, a.map?.summary_polyline);

      const tally = { repaired: 0, cleared: 0, unreachable: 0 };

      for (const row of rows) {
        if (!polylineById.has(row.strava_activity_id)) {
          tally.unreachable++;
          continue;
        }
        const route = routeFromSummaryPolyline(polylineById.get(row.strava_activity_id));
        // No route, and the row already admits it — nothing to write. Without
        // this, every pass would rewrite the same `false` onto the same rows and
        // re-fire migration 047's route_preview trigger for no reason.
        if (!route && !row.has_polyline) continue;

        const { error: updateError } = await supabase
          .from('athlete_activities')
          .update(
            route
              ? { gps_points: route, has_polyline: true }
              // gps_points stays NULL rather than []: "no route" and "never
              // fetched" must not become indistinguishable. Clearing the flag is
              // what stops the feed reserving a map area it cannot fill — 112
              // rows were in exactly that state.
              : { has_polyline: false },
          )
          .eq('id', row.id);
        if (updateError) {
          console.warn(
            `Route backfill for Strava activity ${row.strava_activity_id} failed:`,
            updateError.message,
          );
          continue;
        }
        if (route) tally.repaired++;
        else tally.cleared++;
      }

      out.repaired += tally.repaired;
      out.cleared += tally.cleared;
      out.unreachable += tally.unreachable;
      out.results.push({ athleteId: athlete.id, name: athlete.name, ...tally });
    } catch (e: unknown) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  return out;
}
