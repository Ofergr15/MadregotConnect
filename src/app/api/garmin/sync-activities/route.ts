import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { GarminClient } from '@/lib/garmin/client';
import { COACH_ID } from '@/lib/constants';
import { notifyAthlete, notifyTeammatesOfActivity } from '@/lib/push';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { checkAndAwardChallenges } from '@/lib/challenges/engine';
import { checkShoeAlert } from '@/lib/shoes';
import { notifyMainWorkoutFeedback } from '@/lib/post-workout';
import { hasCrossSourceDuplicate } from '@/lib/activity-dedup';
import { mapActivityDetail } from '@/lib/garmin/activity-detail';
import { requireCallerForAthlete, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

/**
 * HTTP entry point. Anyone could previously trigger a full-club Garmin sync —
 * one unauthenticated POST per second was a free way to burn the club's Garmin
 * rate limit and push a feedback nudge at every athlete.
 *
 * The crons call `runSyncRequest` below directly instead of going through this
 * gate: they authenticate with CRON_SECRET at their own entry point, and an
 * in-process call has no session to present.
 */
export async function POST(request: Request) {
  // clone() because the body is read again inside runSyncRequest, and a Request
  // body can only be consumed once.
  const { athleteId } = await request.clone().json().catch(() => ({} as { athleteId?: string }));
  const { denied } = await requireCallerForAthlete(request, athleteId);
  if (denied) return denied;
  return runSyncRequest(request);
}

export async function runSyncRequest(request: Request) {
  try {
    // suppressPush: skip the inline post-workout feedback nudge. Used by the
    // morning workout-watch cron, which sends its own "new workout detected"
    // teaser instead — so the athlete gets one morning push, not two.
    const { athleteId, suppressPush } = await request.json().catch(() => ({}));
    const supabase = createServerClient();

    // .returns<any[]>() — cols is a runtime string (not a literal), so Supabase
    // can't infer a field-shaped row type from it; that would otherwise fall
    // back to a useless generic error type instead of the athletes row shape.
    const buildAthleteQuery = (cols: string) => {
      let q = supabase.from('athletes').select(cols);
      q = athleteId ? q.eq('id', athleteId) : q.eq('coach_id', COACH_ID).not('garmin_auth', 'is', null);
      return q.returns<any[]>();
    };

    let { data: athletes, error: athError } = await buildAthleteQuery('id, name, garmin_auth, active_shoe_id');
    if (athError?.code === '42703') {
      // active_shoe_id not migrated yet — degrade to the pre-shoes shape
      // rather than failing sync for every athlete over one missing column.
      ({ data: athletes, error: athError } = await buildAthleteQuery('id, name, garmin_auth'));
    }
    if (athError) throw athError;
    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No athletes with Garmin auth found' });
    }

    let totalSynced = 0;
    const results: Array<{ athleteId: string; name: string; synced: number; error?: string }> = [];

    for (const athlete of athletes) {
      if (!athlete.garmin_auth) continue;

      try {
        const client = new GarminClient(athlete.garmin_auth as any);
        let activities;
        try {
          activities = await client.getActivities(0, 100);
        } catch (fetchErr: any) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: `Fetch failed: ${fetchErr.message}` });
          continue;
        }

        if (!activities || activities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: 'No activities returned from Garmin' });
          continue;
        }

        const runTypes = ['running', 'trail_running', 'treadmill_running', 'track_running', 'street_running', 'indoor_running'];
        const runActivities = activities.filter(a =>
          runTypes.includes(a.activityType) || a.activityType.includes('running')
        );

        if (runActivities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: `No runs. Types found: ${activities.slice(0, 5).map(a => a.activityType).join(', ')}` });
          continue;
        }

        const { data: existing } = await supabase
          .from('athlete_activities')
          .select('garmin_activity_id')
          .eq('athlete_id', athlete.id);

        const existingIds = new Set((existing || []).map(e => e.garmin_activity_id));
        const candidateActivities = runActivities.filter(a => !existingIds.has(a.activityId));

        // Strava can independently import this same run (Garmin auto-export) —
        // strava/sync-activities' own existingByStrava check can never catch that,
        // since it's keyed by strava_activity_id. Without this, every such run gets
        // counted twice (badges, challenges, shoe mileage, teammate pushes). See
        // hasCrossSourceDuplicate's own comment.
        const newActivities: typeof candidateActivities = [];
        for (const a of candidateActivities) {
          if (await hasCrossSourceDuplicate(supabase, athlete.id, a.startTimeLocal, a.distance)) continue;
          newActivities.push(a);
        }

        if (newActivities.length > 0) {
          const rows: Record<string, any>[] = [];
          for (const a of newActivities) {
            // Detail and GPS are fetched INDEPENDENTLY, and the polyline is
            // requested unconditionally. Both matter:
            //  - the old code only fetched GPS when `detail.hasPolyline` was
            //    true, but that field reads null on every real response (see
            //    lib/garmin/activity-detail.ts), so no run ever got a route —
            //    hence no map anywhere in the app.
            //  - the old code fetched both inside one try, so a detail failure
            //    also cost the polyline.
            // getActivityGpsPoints already returns [] for a genuinely GPS-less
            // activity (treadmill) or any error, so it's safe to always ask.
            let detail: any = null;
            try {
              detail = await client.getActivityFull(a.activityId);
            } catch { /* the list row + polyline still carry most of it */ }
            const gpsPoints = await client.getActivityGpsPoints(a.activityId);
            const enriched = mapActivityDetail(detail, a, gpsPoints);

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
              shoe_id: athlete.active_shoe_id || null,
              ...enriched,
            });
          }

          // upsert + ignoreDuplicates (not a plain insert) — two overlapping
          // syncs for the same athlete (e.g. two workout-watch cron
          // invocations, one running long enough to still be in this
          // per-activity Garmin API loop when the next fires) can both
          // compute the same "new" activity from their own existingIds
          // snapshot; a plain insert would throw a unique_violation on the
          // second one and fail this whole batch, unlike Strava's per-
          // activity upsert, which already guards exactly this race.
          let { data: insertedRows, error: insertError } = await supabase
            .from('athlete_activities')
            .upsert(rows, { onConflict: 'athlete_id,garmin_activity_id', ignoreDuplicates: true })
            .select('id, garmin_activity_id');

          if (insertError?.code === '42703' || insertError?.code === 'PGRST204' || insertError?.code === '23503') {
            // 42703/PGRST204: shoe_id not migrated yet. 23503: active_shoe_id
            // was read once at the top of this request and the athlete
            // deleted that shoe mid-sync (this loop makes sequential Garmin
            // detail/GPS calls per activity, so the window can be seconds
            // long) — the stale reference fails the FK constraint. Either
            // way, retry without shoe_id rather than losing this whole
            // batch's activities (badges/streaks/teammate notify/feedback
            // prompt all depend on the insert succeeding).
            ({ data: insertedRows, error: insertError } = await supabase
              .from('athlete_activities')
              .upsert(rows.map(({ shoe_id, ...rest }) => rest), { onConflict: 'athlete_id,garmin_activity_id', ignoreDuplicates: true })
              .select('id, garmin_activity_id'));
          }
          if (insertError) throw insertError;
          totalSynced += newActivities.length;

          // One check per batch (not per activity) — checkShoeAlert already
          // sums every activity on the shoe, so re-checking per-row here would
          // just re-derive the same total repeatedly.
          if (athlete.active_shoe_id) await checkShoeAlert(athlete.active_shoe_id);

          // Map back to the real row id per Garmin activity, so kudos (which
          // targets athlete_activities.id, not the legacy garmin_activity_id)
          // has something real to reference.
          const idByGarminActivityId = new Map(
            (insertedRows || []).map((r: { id: string; garmin_activity_id: number }) => [r.garmin_activity_id, r.id]),
          );

          // Notify group teammates for each genuinely new run just inserted
          // above (never for anything filtered out of `newActivities` via
          // `existingIds`, i.e. never on a re-sync of something already
          // known). `rows` was built 1:1 in the same order as `newActivities`.
          // Never let a push failure break the sync itself.
          try {
            await Promise.all(
              newActivities.map(async (a, i) => {
                const row = rows[i];
                const activityId = idByGarminActivityId.get(a.activityId);
                if (!activityId) return; // shouldn't happen, but never notify without a real target
                try {
                  await notifyTeammatesOfActivity({
                    athleteId: athlete.id,
                    activityKey: `${athlete.id}-${a.activityId}`,
                    activityId,
                    distanceMeters: row.distance,
                  });
                } catch (notifyErr) {
                  console.warn(`Teammate notify for Garmin activity ${a.activityId} failed:`, notifyErr);
                }
              }),
            );
          } catch { /* belt-and-suspenders: inner catch already handles per-activity failures */ }

          // Post-workout nudge (PRD §1): push the athlete to fill the feedback
          // questionnaire for the day's MAIN workout. Inline (not cron) so
          // it's timely; never let a push failure break the sync. Skipped
          // when suppressPush is set (the morning workout-watch cron sends
          // its own teaser instead).
          //
          // Ledgered per athlete+day (notifyMainWorkoutFeedback), not scoped
          // to just this call's newActivities — a quality day often syncs as
          // several separate Garmin activities (warmup, interval/tempo set,
          // cooldown), and syncing more than once in a day (mid-run, then
          // again after finishing) used to fire this prompt once per call,
          // each only considering that call's own batch.
          if (!suppressPush) {
            const newest = newActivities.reduce((a, b) => (new Date(a.startTimeLocal) > new Date(b.startTimeLocal) ? a : b));
            await notifyMainWorkoutFeedback({ athleteId: athlete.id, dateStr: newest.startTimeLocal.split('T')[0] });
          }

          // "Customize your post" nudge — same sheet the Strava client-side
          // sync-diff opens in dashboard/page.tsx, but a Garmin sync runs on
          // a server schedule with no page open to diff against, so this
          // deep-links straight into that same sheet via ?editActivity=<id>
          // instead. 24h guard: a first-ever Garmin connection backfills
          // months of history as "new" here — skip anything older so that
          // backfill doesn't pop the sheet for a run from months ago.
          try {
            const RECENT_MS = 24 * 60 * 60 * 1000;
            const recentNew = newActivities.filter(
              a => Date.now() - new Date(a.startTimeLocal).getTime() < RECENT_MS,
            );
            if (recentNew.length > 0) {
              const latest = recentNew.reduce((a, b) => (new Date(a.startTimeLocal) > new Date(b.startTimeLocal) ? a : b));
              const latestRowId = idByGarminActivityId.get(latest.activityId);
              if (latestRowId) {
                await notifyAthlete({
                  athleteId: athlete.id,
                  kind: 'activity_sync_editor',
                  title: 'האימון שלך סונכרן! 🏃',
                  body: 'התאמה אישית של הפוסט לפני שהוא יוצא לפיד',
                  url: `/dashboard?editActivity=${latestRowId}`,
                  tag: `activity-sync-editor-${latestRowId}`,
                  category: 'workouts',
                });
              }
            }
          } catch { /* push is best-effort */ }

          // New activities can move a PR bucket, the cumulative-distance total,
          // or the run streak — all evaluated in TypeScript (not SQL), so this
          // is "instant enough" right after sync instead of a DB trigger. Never
          // let a badge-check failure break the sync itself.
          try {
            await checkAndAwardBadges(athlete.id);
          } catch { /* badge check is best-effort */ }
          try {
            await checkAndAwardChallenges(athlete.id);
          } catch { /* challenge check is best-effort */ }
        }

        results.push({ athleteId: athlete.id, name: athlete.name, synced: newActivities.length });
      } catch (e: any) {
        results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: e.message });
      }
    }

    return NextResponse.json({ synced: totalSynced, results });
  } catch (error: any) {
    console.error('Activity sync error:', error);
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}

/**
 * Re-runnable enrichment backfill for rows the POST path stored with missing
 * columns — chiefly the whole pre-fix history, whose `has_polyline: false`
 * meant no GPS was ever fetched and so no `route_preview` was ever built.
 *
 *   ?mode=route    (default) rows with no stored GPS — the map repair
 *   ?mode=missing  rows with no avg_cadence — the original behaviour
 *   ?limit=N       rows per call, 1-100 (default 25; Garmin calls are serial,
 *                  ~2 requests per row, so keep it inside maxDuration)
 *   ?before=<ISO>  only rows older than this start_time — the batch cursor
 *
 * `mode=route` selects on `gps_points IS NULL` — migration 018's own definition
 * of "not yet fetched" — and deliberately NOT on `has_polyline`. That flag is
 * unreliable in exactly the rows this backfill exists to repair: the pre-fix
 * sync read `hasPolyline` from the activity-LIST row (which populates) while
 * gating the GPS fetch on the detail root (which is null in production), so it
 * stored has_polyline=true with no route behind it. Measured live: 316 rows
 * flagged true, gps_points NULL — invisible to a has_polyline filter, and all
 * of them recent, which is precisely the stretch of feed anyone actually looks
 * at. Cross-checked at the same time: 0 rows have gps_points without a
 * route_preview, so migration 047's trigger fires correctly on UPDATE and the
 * only thing ever missing is the GPS itself.
 *
 * Reachable set, measured: 1064 rows. The other 230 route-less rows are
 * Strava-sourced and are skipped by the id filter below — Garmin cannot supply
 * their routes at any price.
 *
 * `before` is what makes a full-history sweep terminate. Without it the filter
 * alone can't distinguish "GPS not fetched yet" from "this run genuinely has no
 * GPS" (a treadmill session keeps a NULL gps_points forever), so those rows
 * sit at the top of every ascending-recency batch and the caller re-processes
 * the same 20 rows for eternity — observed live: routesAdded decayed 19 → 8 as
 * the clog grew. The response returns `nextBefore`, the oldest start_time this
 * call touched, for the caller to pass back on the next one.
 *
 * Idempotent and non-destructive: nulls are never written over existing
 * values, and gps_points/has_polyline are only touched when a real route came
 * back — a transient Garmin failure must not wipe a route it already has.
 */
export async function PATCH(request: Request) {
  try {
    // Staff-only: this walks the activity table making two Garmin requests per
    // row, so an open handler was a way to burn the club's Garmin quota.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') === 'missing' ? 'missing' : 'route';
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 100);
    const before = searchParams.get('before');

    let query = supabase
      .from('athlete_activities')
      .select('id, garmin_activity_id, athlete_id, start_time, has_polyline')
      // `> 0`, not merely NOT NULL: a Strava-sourced row stores the NEGATED
      // Strava id in this column (source='strava', garmin_activity_id =
      // -strava_activity_id), so a null check lets 230 rows through that Garmin
      // has never heard of. Every one of them costs two doomed Garmin requests
      // and comes back all-null, which then looks exactly like "this run has no
      // GPS". Those rows need Strava's own polyline, not this endpoint.
      .gt('garmin_activity_id', 0)
      .order('start_time', { ascending: false })
      .limit(limit);
    query = mode === 'missing' ? query.is('avg_cadence', null) : query.is('gps_points', null);
    if (before) query = query.lt('start_time', before);

    const { data: activities, error: selectError } = await query;
    if (selectError) throw selectError;

    if (!activities || activities.length === 0) {
      return NextResponse.json({ enriched: 0, mode, nextBefore: null, message: 'Nothing left to enrich' });
    }

    // Rows come back newest-first, so the last one is the oldest this call saw.
    const nextBefore = (activities[activities.length - 1] as { start_time: string }).start_time;

    const athleteIds = [...new Set(activities.map(a => a.athlete_id))];
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, garmin_auth')
      .in('id', athleteIds)
      .not('garmin_auth', 'is', null);

    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ error: 'No athletes with Garmin auth' }, { status: 404 });
    }

    const clientMap = new Map<string, GarminClient>();
    for (const ath of athletes) {
      clientMap.set(ath.id, new GarminClient(ath.garmin_auth as any));
    }

    // One activity-LIST fetch per athlete, indexed by activityId: the list row
    // is the fallback source mapActivityDetail needs when the detail response
    // comes back all-null, and it's a single request for up to 100 rows.
    const listCache = new Map<string, Map<number, any>>();
    const listFor = async (athleteId: string, client: GarminClient) => {
      const cached = listCache.get(athleteId);
      if (cached) return cached;
      let index = new Map<number, any>();
      try {
        const list = await client.getActivities(0, 100);
        index = new Map(list.map(a => [a.activityId, a]));
      } catch { /* fallback source is optional */ }
      listCache.set(athleteId, index);
      return index;
    };

    let enriched = 0;
    let routesAdded = 0;
    const errors: string[] = [];

    for (const act of activities) {
      const client = clientMap.get(act.athlete_id);
      if (!client) continue;

      try {
        let detail: any = null;
        try {
          detail = await client.getActivityFull(act.garmin_activity_id);
        } catch { /* the list row + polyline still carry most of it */ }
        const gpsPoints = await client.getActivityGpsPoints(act.garmin_activity_id);
        const list = (await listFor(act.athlete_id, client)).get(act.garmin_activity_id) || {};
        const mapped = mapActivityDetail(detail, list, gpsPoints);

        // Drop nulls: an absent value here means "Garmin didn't tell us", not
        // "clear the column". Ditto gps_points/has_polyline unless a real
        // route came back — writing [] would clobber an existing polyline and
        // re-fire migration 047's trigger to null out route_preview.
        const { gps_points, has_polyline, ...scalars } = mapped;
        const update: Record<string, any> = Object.fromEntries(
          Object.entries(scalars).filter(([, v]) => v != null),
        );
        if (has_polyline) {
          update.gps_points = gps_points;
          update.has_polyline = true;
          routesAdded++;
        } else if (act.has_polyline) {
          // Garmin has no polyline for this run, yet the flag claims one. Clear
          // it so `hasRoute` in lib/feed/project.ts stops promising a map that
          // can never be drawn. gps_points stays NULL rather than [] — "not
          // fetched" is the honest state, and writing [] would make the row
          // indistinguishable from a real empty route.
          update.has_polyline = false;
        }

        if (Object.keys(update).length > 0) {
          const { error: updateError } = await supabase.from('athlete_activities').update(update).eq('id', act.id);
          if (updateError) throw updateError;
          enriched++;
        }
      } catch (e: any) {
        errors.push(`${act.garmin_activity_id}: ${e.message}`);
      }
    }

    return NextResponse.json({
      enriched,
      routesAdded,
      total: activities.length,
      mode,
      nextBefore,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    // Staff-only: this is the raw-Garmin-field dump used for debugging, and it
    // returns a real athlete's activity payload verbatim.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, name, garmin_auth')
      .eq('coach_id', COACH_ID)
      .not('garmin_auth', 'is', null)
      .limit(1);

    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ error: 'No athletes' }, { status: 404 });
    }

    const client = new GarminClient(athletes[0].garmin_auth as any);
    const raw = await (client as any).gc.getActivities(0, 2) as any[];
    const sample = raw[0];
    const keys = Object.keys(sample || {});
    const relevant = {
      startLatitude: sample?.startLatitude,
      startLongitude: sample?.startLongitude,
      endLatitude: sample?.endLatitude,
      endLongitude: sample?.endLongitude,
      hasPolyline: sample?.hasPolyline,
      lapCount: sample?.lapCount,
      locationName: sample?.locationName,
      vO2MaxValue: sample?.vO2MaxValue,
      avgStrideLength: sample?.avgStrideLength,
      averageRunningCadenceInStepsPerMinute: sample?.averageRunningCadenceInStepsPerMinute,
      movingDuration: sample?.movingDuration,
      steps: sample?.steps,
    };
    return NextResponse.json({ keys, relevant, raw: sample });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');

    // Coaches/admins may request the whole club (roster feed); everyone else is
    // scoped to their own activities.
    //
    // The previous version resolved staff status from `x-user-email`, and — worse
    // — never checked that a non-staff caller's `athleteId` was their OWN. So an
    // unauthenticated GET naming any athlete returned that athlete's entire
    // history: verified live against production, 147 activities / 5.9MB with
    // name, HR, pace and GPS start/end coordinates. No client in the app calls
    // this GET at all.
    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    const isStaff = caller.isSuperUser || caller.isStaff;

    const supabase = createServerClient();

    const baseCols = `
        id, athlete_id, garmin_activity_id, activity_name, activity_type,
        start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr,
        calories, elevation_gain, start_lat, start_lng, end_lat, end_lng,
        avg_cadence, avg_stride_length, vo2max, lap_count, location_name,
        has_polyline, splits, created_at,
        athletes (name)`;

    const runQuery = (cols: string) => {
      let q = supabase
        .from('athlete_activities')
        .select(cols)
        .order('start_time', { ascending: false })
        .limit(200);
      // Scope to the caller unless they're verified staff.
      if (!isStaff && athleteId) q = q.eq('athlete_id', athleteId);
      return q;
    };

    // Prefer selecting gps_points; fall back gracefully if the column hasn't
    // been added yet (migration 018 not yet run) so the feed never 500s.
    let activities: any[] | null = null;
    let error: any = null;
    ({ data: activities, error } = await runQuery(`${baseCols}, gps_points`));

    if (error) {
      ({ data: activities, error } = await runQuery(baseCols));
    }

    if (error) throw error;

    const enriched = (activities || []).map((a: any) => ({
      ...a,
      athlete_name: a.athletes?.name || 'Unknown',
      athletes: undefined,
    }));

    return NextResponse.json({ activities: enriched });
  } catch (error: any) {
    console.error('Fetch activities error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
