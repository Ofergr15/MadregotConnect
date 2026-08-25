import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { GarminClient } from '@/lib/garmin/client';
import { COACH_ID } from '@/lib/constants';
import { notifyAthlete, notifyTeammatesOfActivity } from '@/lib/push';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { checkAndAwardChallenges } from '@/lib/challenges/engine';
import { checkShoeAlert } from '@/lib/shoes';
import { notifyMainWorkoutFeedback } from '@/lib/post-workout';

export async function POST(request: Request) {
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
        const newActivities = runActivities.filter(a => !existingIds.has(a.activityId));

        if (newActivities.length > 0) {
          const rows: Record<string, any>[] = [];
          for (const a of newActivities) {
            let enriched: any = {};
            try {
              const detail = await client.getActivityFull(a.activityId);
              const summ = detail?.summaryDTO || {};
              // Persist the route polyline so maps load instantly and reliably.
              // [] means "confirmed no GPS" (treadmill/indoor); only fetch when
              // the activity claims a polyline to keep sync fast.
              const gpsPoints = detail.hasPolyline
                ? await client.getActivityGpsPoints(a.activityId)
                : [];
              enriched = {
                start_lat: detail.startLatitude || null,
                start_lng: detail.startLongitude || null,
                end_lat: summ.endLatitude || detail.endLatitude || null,
                end_lng: summ.endLongitude || detail.endLongitude || null,
                avg_cadence: summ.averageRunCadence || null,
                avg_stride_length: summ.strideLength ? Math.round(summ.strideLength * 100) : null,
                vo2max: detail.vO2MaxValue || null,
                lap_count: detail.lapCount || null,
                location_name: detail.locationName || null,
                has_polyline: detail.hasPolyline || false,
                gps_points: gpsPoints,
                moving_duration: summ.movingDuration ? Math.round(summ.movingDuration) : Math.round(a.movingDuration),
                // Garmin "Self Evaluation" (only present if answered on-watch).
                perceived_rpe: summ.directWorkoutRpe != null ? summ.directWorkoutRpe / 10 : null,
                perceived_feel: summ.directWorkoutFeel != null ? summ.directWorkoutFeel / 25 : null,
              };
            } catch {
              enriched = {
                start_lat: a.startLatitude,
                start_lng: a.startLongitude,
                end_lat: a.endLatitude,
                end_lng: a.endLongitude,
                avg_cadence: a.averageRunningCadence,
                avg_stride_length: a.avgStrideLength,
                vo2max: a.vO2MaxValue,
                lap_count: a.lapCount,
                location_name: a.locationName,
                has_polyline: a.hasPolyline,
                moving_duration: Math.round(a.movingDuration),
              };
            }

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

          let { data: insertedRows, error: insertError } = await supabase
            .from('athlete_activities')
            .insert(rows)
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
              .insert(rows.map(({ shoe_id, ...rest }) => rest))
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
                    durationSeconds: row.duration,
                    averagePaceSecPerKm: row.average_pace,
                    averageHr: row.average_hr,
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

export async function PATCH(request: Request) {
  try {
    const supabase = createServerClient();

    const { data: activities } = await supabase
      .from('athlete_activities')
      .select('id, garmin_activity_id, athlete_id')
      .is('avg_cadence', null)
      .limit(20);

    if (!activities || activities.length === 0) {
      return NextResponse.json({ enriched: 0, message: 'All activities already enriched' });
    }

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

    let enriched = 0;
    const errors: string[] = [];

    for (const act of activities) {
      const client = clientMap.get(act.athlete_id);
      if (!client) continue;

      try {
        const detail = await client.getActivityFull(act.garmin_activity_id);
        const summ = detail?.summaryDTO || {};
        const update: any = {};
        if (detail.startLatitude) update.start_lat = detail.startLatitude;
        if (detail.startLongitude) update.start_lng = detail.startLongitude;
        if (summ.endLatitude || detail.endLatitude) update.end_lat = summ.endLatitude || detail.endLatitude;
        if (summ.endLongitude || detail.endLongitude) update.end_lng = summ.endLongitude || detail.endLongitude;
        if (summ.averageRunCadence) update.avg_cadence = summ.averageRunCadence;
        if (summ.strideLength) update.avg_stride_length = Math.round(summ.strideLength * 100);
        if (detail.vO2MaxValue) update.vo2max = detail.vO2MaxValue;
        if (detail.lapCount) update.lap_count = detail.lapCount;
        if (detail.locationName) update.location_name = detail.locationName;
        if (detail.hasPolyline != null) update.has_polyline = detail.hasPolyline;
        if (summ.movingDuration) update.moving_duration = Math.round(summ.movingDuration);
        // Garmin "Self Evaluation" — backfill on older rows when present.
        if (summ.directWorkoutRpe != null) update.perceived_rpe = summ.directWorkoutRpe / 10;
        if (summ.directWorkoutFeel != null) update.perceived_feel = summ.directWorkoutFeel / 25;

        if (Object.keys(update).length > 0) {
          await supabase
            .from('athlete_activities')
            .update(update)
            .eq('id', act.id);
          enriched++;
        }
      } catch (e: any) {
        errors.push(`${act.garmin_activity_id}: ${e.message}`);
      }
    }

    return NextResponse.json({ enriched, total: activities.length, errors: errors.length > 0 ? errors : undefined });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
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
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    // Coaches/admins may request the whole club (roster feed); everyone else is
    // scoped to their own activities. Coach status is proven via x-user-email
    // checked against the DB — NOT trusted from the client — so a runner can't
    // just omit athleteId to see everyone's names/HR/GPS (the prior P0 leak).
    let isStaff = false;
    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    if (email) {
      const { data: me } = await supabase
        .from('athletes')
        .select('role')
        .eq('email', email)
        .in('role', ['coach', 'admin', 'academy_coach'])
        .maybeSingle();
      isStaff = !!me;
    }

    // A non-staff caller MUST pass their own athleteId and gets only their rows.
    if (!isStaff && !athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

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
