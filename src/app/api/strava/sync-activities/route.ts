/**
 * POST /api/strava/sync-activities
 * Body: { athleteId?: string }
 *
 * Syncs Strava runs into athlete_activities (laps + gps_points + GPX).
 * When athleteId is omitted, syncs every athlete with data_source=strava.
 *
 * PATCH /api/strava/sync-activities?mode=route
 * Staff-only one-shot repair of runs already stored without geometry. See the
 * handler's own comment — the POST path only reaches an athlete's backlog when
 * that athlete personally opens the app.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';
import { StravaClient, type StravaTokens } from '@/lib/strava/client';
import {
  enrichStravaActivity,
  getValidStravaToken,
  isMissingColumnError,
} from '@/lib/strava/enrich';
import { routeFromSummaryPolyline } from '@/lib/strava/polyline';
import { backfillStravaRoutes } from '@/lib/strava/backfill-routes';
import { matchAthleteActivities } from '@/lib/plans/match-athlete-activities';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { checkAndAwardChallenges } from '@/lib/challenges/engine';
import { notifyTeammatesOfActivity } from '@/lib/push';
import { checkShoeAlert } from '@/lib/shoes';
import { notifyMainWorkoutFeedback } from '@/lib/post-workout';
import { hasCrossSourceDuplicate } from '@/lib/activity-dedup';
import { requireCallerForAthlete, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId = body?.athleteId as string | undefined;

    // Same gate as the Garmin sync: your own athleteId, or staff for a
    // whole-club sync. Nothing calls this in-process, so there's no cron
    // bypass to keep here.
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    // suppressPush: skip the inline post-workout feedback nudge — mirrors
    // garmin/sync-activities' same param, for a future cron teaser to reuse.
    const suppressPush = !!body?.suppressPush;
    const supabase = createServerClient();

    // .returns<any[]>() — cols is a runtime string (not a literal), so Supabase
    // can't infer a field-shaped row type from it; that would otherwise fall
    // back to a useless generic error type instead of the athletes row shape.
    const fetchAthletes = (cols: string) => (
      athleteId
        ? supabase.from('athletes').select(cols).eq('id', athleteId).not('strava_auth', 'is', null).returns<any[]>()
        : supabase.from('athletes').select(cols).eq('data_source', 'strava').not('strava_auth', 'is', null)
            .or(`coach_id.eq.${COACH_ID},coach_id.is.null`).returns<any[]>()
    );
    let { data: athletes, error: athError } = await fetchAthletes('id, name, strava_auth, data_source, active_shoe_id');
    if (athError?.code === '42703') {
      // active_shoe_id not migrated yet — degrade to the pre-shoes shape
      // rather than failing sync for every athlete over one missing column.
      ({ data: athletes, error: athError } = await fetchAthletes('id, name, strava_auth, data_source'));
    }
    if (athError) throw athError;
    if (!athletes?.length) {
      return NextResponse.json({ synced: 0, message: 'No athletes with Strava auth found' });
    }

    let totalSynced = 0;
    const results: Array<{
      athleteId: string;
      name: string;
      synced: number;
      fetched?: number;
      runs?: number;
      /** Routes recovered onto runs already stored without one. */
      routesAdded?: number;
      planMatches?: number;
      error?: string;
    }> = [];

    const isRun = (a: { type?: string; sport_type?: string }) => {
      const t = a.type || a.sport_type || '';
      return t === 'Run' || t === 'TrailRun' || t === 'VirtualRun';
    };

    // Enrichment (laps + GPX) costs two or three Strava calls per run against a
    // 100-per-15-minutes limit, so it runs on a budget — and the budget is
    // club-wide, where it used to be reset inside the athlete loop: a sync of N
    // Strava athletes could spend N × 15 × ~3 calls and breach the limit.
    //
    // Two budgets, because one number cannot do both jobs:
    //
    //   RECENT    the live path. A run someone finished this morning must get its
    //             laps on this sync, not eventually.
    //   BACKFILL  the history. The old code had a hard 45-day gate and no
    //             backfill at all, which is why 170 of 175 Strava runs have no
    //             laps: past the window a run could never be enriched however
    //             many times the sync passed over it, so the backlog was
    //             permanent and the splits table had nothing to show.
    //
    // Keeping them apart is the whole point — one shared budget would let a
    // 154-run historical backlog crowd out a run finished an hour ago.
    // `needsEnrich` goes false once laps are stored (enrich writes `[]` when
    // Strava has none), so each sync spends the backfill budget on the next slice
    // and the backlog drains instead of being retried forever.
    const RECENT_ENRICH_LIMIT = 15;
    const BACKFILL_ENRICH_LIMIT = 10;
    const RECENT_MS = 45 * 24 * 60 * 60 * 1000;
    let recentEnriched = 0;
    let backfilled = 0;
    // Claims a slot from the right budget, so callers cannot forget to count.
    const shouldEnrich = (startLocal: string) => {
      if (Date.now() - new Date(startLocal).getTime() < RECENT_MS) {
        if (recentEnriched >= RECENT_ENRICH_LIMIT) return false;
        recentEnriched++;
        return true;
      }
      if (backfilled >= BACKFILL_ENRICH_LIMIT) return false;
      backfilled++;
      return true;
    };

    for (const athlete of athletes) {
      if (!athlete.strava_auth) continue;
      try {
        const auth = decrypt(athlete.strava_auth as string) as StravaTokens;
        const token = await getValidStravaToken(supabase, athlete.id, auth);
        if (!token) {
          results.push({
            athleteId: athlete.id,
            name: athlete.name,
            synced: 0,
            error: 'Token refresh failed',
          });
          continue;
        }

        const client = new StravaClient(token);
        // Rolling 180 days on login/cron; paginate within that window
        const after = Math.floor((Date.now() - 180 * 24 * 60 * 60 * 1000) / 1000);
        const activities = await client.getAllActivities({ after, maxPages: 5, perPage: 100 });
        const runActivities = activities.filter(isRun);

        type ExistingRow = { id: string; strava_activity_id: number | null; laps: unknown; strava_gpx_url?: string | null };
        let hasGpxColumn = true;
        let { data: existing, error: existingError } = await supabase
          .from('athlete_activities')
          .select('id, strava_activity_id, start_time, laps, strava_gpx_url')
          .eq('athlete_id', athlete.id)
          .returns<ExistingRow[]>();
        if (existingError && isMissingColumnError(existingError)) {
          // Pre-migration-051 database. Without this fallback the lookup came
          // back empty, every run looked new, and enrichment never ran.
          hasGpxColumn = false;
          ({ data: existing, error: existingError } = await supabase
            .from('athlete_activities')
            .select('id, strava_activity_id, start_time, laps')
            .eq('athlete_id', athlete.id)
            .returns<ExistingRow[]>());
        }
        if (existingError) throw existingError;

        const existingByStrava = new Map<number, { id: string; needsEnrich: boolean }>();
        for (const e of existing || []) {
          if (e.strava_activity_id) {
            existingByStrava.set(e.strava_activity_id, {
              id: e.id,
              // null laps = never enriched (enrich stores [] when Strava has none)
              needsEnrich: e.laps == null || (hasGpxColumn && !e.strava_gpx_url),
            });
          }
        }

        // Which already-stored runs still have no route, and whether each one
        // currently claims to have one. Fetched as its own query rather than
        // added to the lookup above on purpose: gps_points holds thousands of
        // coordinates per row, so selecting the column just to test it for null
        // would pull megabytes per athlete across the whole history.
        //
        // Measured on production before this change: 171 of 175 Strava runs had
        // no route at all, and 112 of those had has_polyline = true — the feed
        // was reserving a map area for runs whose geometry had been thrown away.
        const routeless = new Map<number, boolean>();
        const { data: routelessRows, error: routelessError } = await supabase
          .from('athlete_activities')
          .select('strava_activity_id, has_polyline')
          .eq('athlete_id', athlete.id)
          .eq('source', 'strava')
          .is('gps_points', null)
          .not('strava_activity_id', 'is', null)
          .returns<Array<{ strava_activity_id: number | null; has_polyline: boolean | null }>>();
        if (routelessError) {
          // Repairing old rows is a bonus pass; never fail the whole sync for it.
          console.warn(`Routeless lookup for ${athlete.id} skipped:`, routelessError.message);
        }
        for (const r of routelessRows || []) {
          if (r.strava_activity_id != null) routeless.set(r.strava_activity_id, !!r.has_polyline);
        }
        let routesAdded = 0;

        let synced = 0;
        const insertErrors: string[] = [];
        // Post-workout feedback nudge (same purpose as Garmin sync's) needs
        // the newest genuinely-new activity's details after the loop below.
        const newActivityPushInfo: Array<{ activityId: number; distance: number; activityType: string; startTimeLocal: string }> = [];
        for (const a of runActivities) {
          const known = existingByStrava.get(a.id);
          if (known) {
            // Recover the route from the summary polyline this list response
            // already carries. Deliberately NOT behind shouldEnrich: that gate
            // protects the rate-limited streams call, and applying it here would
            // leave every run older than 45 days permanently map-less. This
            // costs no request at all, so there is no budget to protect.
            const claimsRoute = routeless.get(a.id);
            if (claimsRoute !== undefined) {
              const route = routeFromSummaryPolyline(a.map?.summary_polyline);
              // Nothing to draw and the flag already admits it: leave the row
              // alone instead of writing the same `false` back on every sync.
              if (route || claimsRoute) {
                const { error: routeError } = await supabase
                  .from('athlete_activities')
                  .update(
                    route
                      ? { gps_points: route, has_polyline: true }
                      // Strava has no route for this run (treadmill, or a manual
                      // entry). Clear the flag so hasRoute in lib/feed/project.ts
                      // stops promising a map that cannot be drawn. gps_points
                      // stays NULL rather than [] — "no route" and "not fetched"
                      // should not become indistinguishable.
                      : { has_polyline: false },
                  )
                  .eq('id', known.id);
                if (routeError) {
                  console.warn(`Route repair for Strava activity ${a.id} failed:`, routeError.message);
                } else if (route) {
                  routesAdded++;
                }
              }
            }
            if (known.needsEnrich && shouldEnrich(a.start_date_local)) {
              await enrichStravaActivity(supabase, client, {
                athleteId: athlete.id,
                stravaActivityId: a.id,
                activityName: a.name,
                startTimeLocal: a.start_date_local,
                rowId: known.id,
              });
            }
            continue;
          }

          const durationSec = a.moving_time || a.elapsed_time;
          const distanceM = a.distance;

          // Garmin can auto-export this same run to Strava — garmin/sync-activities
          // already inserted it under a positive garmin_activity_id, which
          // existingByStrava (keyed by strava_activity_id) can never match. Without
          // this check every such run gets counted twice (badges, challenges, shoe
          // mileage, teammate pushes). See hasCrossSourceDuplicate's own comment.
          if (await hasCrossSourceDuplicate(supabase, athlete.id, a.start_date_local, distanceM)) {
            continue;
          }

          // The list response carries the entire route as an encoded polyline,
          // and this used to reduce it to `has_polyline: !!…` and drop the
          // geometry on the floor. Decoding it needs no extra request, so a new
          // run has its map from the moment it lands — including the runs
          // enrichment will never reach, which is nearly all of them (newest 15,
          // under 45 days old). Enrichment overwrites this with the finer
          // streams trace when it does run.
          const route = routeFromSummaryPolyline(a.map?.summary_polyline);

          // garmin_activity_id is NOT NULL + UNIQUE(athlete_id, garmin_activity_id).
          // Never reuse a shared sentinel like -1 — that only lets one Strava row insert.
          // Negative Strava id stays out of the positive Garmin id space.
          const row = {
            athlete_id: athlete.id,
            strava_activity_id: a.id,
            garmin_activity_id: -a.id,
            source: 'strava',
            activity_name: a.name,
            activity_type:
              a.type === 'TrailRun' || a.sport_type === 'TrailRun'
                ? 'trail_running'
                : 'running',
            start_time: a.start_date_local,
            distance: Math.round(distanceM),
            duration: Math.round(durationSec),
            average_pace: distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : null,
            average_hr: a.average_heartrate || null,
            max_hr: a.max_heartrate || null,
            calories: a.calories || null,
            elevation_gain: a.total_elevation_gain || null,
            start_lat: a.start_latlng?.[0] || null,
            start_lng: a.start_latlng?.[1] || null,
            end_lat: a.end_latlng?.[0] || null,
            end_lng: a.end_latlng?.[1] || null,
            moving_duration: a.moving_time ? Math.round(a.moving_time) : null,
            gps_points: route,
            has_polyline: !!route,
            shoe_id: athlete.active_shoe_id || null,
          };

          let { data: inserted, error: insertError } = await supabase
            .from('athlete_activities')
            .upsert(row, {
              onConflict: 'athlete_id,garmin_activity_id',
              ignoreDuplicates: true,
            })
            .select('id')
            .maybeSingle();

          if (insertError?.code === '42703' || insertError?.code === 'PGRST204') {
            // shoe_id not migrated yet — retry without it rather than failing
            // sync for every athlete over one missing column.
            const { shoe_id, ...rowWithoutShoe } = row;
            ({ data: inserted, error: insertError } = await supabase
              .from('athlete_activities')
              .upsert(rowWithoutShoe, {
                onConflict: 'athlete_id,garmin_activity_id',
                ignoreDuplicates: true,
              })
              .select('id')
              .maybeSingle());
          }
          if (insertError) {
            insertErrors.push(`${a.id}: ${insertError.message}`);
            console.error('Strava activity insert failed:', a.id, insertError);
            continue;
          }
          // Another overlapping sync inserted it after our initial lookup.
          if (!inserted) continue;

          // Notify group teammates this athlete just finished a run — only
          // reachable here because `row` is a genuinely NEW insert (every
          // activity already known via `existingByStrava` hit `continue`
          // above, and a same-conflict race just above also `continue`d).
          // Never let a push failure break the sync itself.
          try {
            await notifyTeammatesOfActivity({
              athleteId: athlete.id,
              activityKey: inserted.id,
              activityId: inserted.id,
              distanceMeters: row.distance,
            });
          } catch (notifyErr) {
            console.warn(`Teammate notify for Strava activity ${a.id} failed:`, notifyErr);
          }

          if (shouldEnrich(a.start_date_local)) {
            await enrichStravaActivity(supabase, client, {
              athleteId: athlete.id,
              stravaActivityId: a.id,
              activityName: a.name,
              startTimeLocal: a.start_date_local,
              rowId: inserted?.id ?? null,
            });
          }
          synced++;
          // garmin_activity_id (the field the feedback push links to) holds
          // -a.id for Strava rows — see the row's own comment above.
          newActivityPushInfo.push({
            activityId: -a.id,
            distance: row.distance,
            activityType: row.activity_type,
            startTimeLocal: a.start_date_local,
          });
        }

        // One check per batch (not per activity) — checkShoeAlert already
        // sums every activity on the shoe.
        if (athlete.active_shoe_id && newActivityPushInfo.length > 0) {
          await checkShoeAlert(athlete.active_shoe_id);
        }

        // Post-workout nudge — pushes the day's MAIN workout's feedback
        // prompt (longest by distance across ALL of that athlete's
        // activities that day, not just this call's newActivityPushInfo, and
        // ledgered per athlete+day) — see notifyMainWorkoutFeedback's own
        // comment. Previously Strava-synced athletes never got this at all
        // (only Garmin did), and syncing more than once in a day could fire
        // it multiple times, each only considering that call's own batch.
        if (!suppressPush && newActivityPushInfo.length > 0) {
          const newest = newActivityPushInfo.reduce((a, b) => (new Date(a.startTimeLocal) > new Date(b.startTimeLocal) ? a : b));
          await notifyMainWorkoutFeedback({ athleteId: athlete.id, dateStr: newest.startTimeLocal.split('T')[0] });
        }

        let planMatches = 0;
        try {
          planMatches = (await matchAthleteActivities(supabase, athlete.id)).matched;
        } catch (matchError) {
          // Migration 043 may not be applied yet; activity sync itself should still succeed.
          console.warn(`Plan matching for ${athlete.id} skipped:`, matchError);
        }

        // New activities can move a PR bucket, the cumulative-distance total,
        // or the run streak — all evaluated in TypeScript (not SQL), so this
        // is "instant enough" right after sync instead of a DB trigger. Never
        // let a badge-check failure break the sync itself.
        if (synced > 0) {
          try {
            await checkAndAwardBadges(athlete.id);
          } catch (badgeError) {
            console.warn(`Badge check for ${athlete.id} skipped:`, badgeError);
          }
          try {
            await checkAndAwardChallenges(athlete.id);
          } catch (challengeError) {
            console.warn(`Challenge check for ${athlete.id} skipped:`, challengeError);
          }
        }

        totalSynced += synced;
        results.push({
          athleteId: athlete.id,
          name: athlete.name,
          synced,
          fetched: activities.length,
          runs: runActivities.length,
          routesAdded,
          planMatches,
          ...(insertErrors.length
            ? { error: `${insertErrors.length} insert failures: ${insertErrors[0]}` }
            : {}),
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: message });
      }
    }

    // recentEnriched / backfilled are club-wide budgets, so they belong on the
    // envelope rather than per athlete. `backfilled` hitting its cap is how you
    // know the lap backlog is still draining.
    return NextResponse.json({
      synced: totalSynced,
      recentEnriched,
      backfilled,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    console.error('Strava sync error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/strava/sync-activities?mode=route[&athleteId=…][&maxPages=…]
 *
 * Staff-only manual trigger for the route repair — the counterpart the Garmin
 * backfill's own comment asks for ("Those rows need Strava's own polyline, not
 * this endpoint"). The same pass also runs on cron/sync, so this exists for
 * forcing it out of the window or scoping it to one athlete while debugging;
 * see backfillStravaRoutes for what it actually does and why it is cheap.
 */
export async function PATCH(request: Request) {
  try {
    // Staff-only. Cheap is not free: this walks every Strava athlete's history
    // and writes to their activity rows.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const result = await backfillStravaRoutes(createServerClient(), {
      athleteId: searchParams.get('athleteId'),
      maxPages: Number(searchParams.get('maxPages')) || undefined,
    });

    return NextResponse.json(
      result.targets === 0
        ? { ...result, message: 'No Strava runs are missing geometry' }
        : result,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Route backfill failed';
    console.error('Strava route backfill error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
