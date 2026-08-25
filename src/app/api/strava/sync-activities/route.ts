/**
 * POST /api/strava/sync-activities
 * Body: { athleteId?: string }
 *
 * Syncs Strava runs into athlete_activities (laps + gps_points + GPX).
 * When athleteId is omitted, syncs every athlete with data_source=strava.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { decrypt, encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';
import {
  StravaClient,
  refreshStravaToken,
  tokenNeedsRefresh,
  streamsToGpx,
  streamsToGpsPoints,
  type StravaTokens,
} from '@/lib/strava/client';
import { matchAthleteActivities } from '@/lib/plans/match-athlete-activities';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { checkAndAwardChallenges } from '@/lib/challenges/engine';
import { notifyTeammatesOfActivity } from '@/lib/push';
import { checkShoeAlert } from '@/lib/shoes';
import { notifyMainWorkoutFeedback } from '@/lib/post-workout';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BUCKET = 'run-chat';

async function ensureBucket(supabase: ReturnType<typeof createServerClient>) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 20_000_000 });
  }
}

async function getValidToken(
  auth: StravaTokens,
  athleteId: string,
  supabase: ReturnType<typeof createServerClient>,
): Promise<string | null> {
  if (!tokenNeedsRefresh(auth.expires_at)) return auth.access_token;

  const refreshed = await refreshStravaToken(auth.refresh_token);
  if (!refreshed) return null;

  const next: StravaTokens = {
    ...refreshed,
    athlete_id: auth.athlete_id || refreshed.athlete_id,
  };
  await supabase.from('athletes').update({ strava_auth: encrypt(next) }).eq('id', athleteId);
  return next.access_token;
}

async function enrichActivity(
  supabase: ReturnType<typeof createServerClient>,
  client: StravaClient,
  athleteId: string,
  stravaActivityId: number,
  activityName: string,
  startTimeLocal: string,
  rowId: string | null,
) {
  try {
    const laps = await client.getActivityLaps(stravaActivityId);
    const streams = await client.getActivityStreams(stravaActivityId);
    const gps_points = streamsToGpsPoints(streams);
    const gpx = streamsToGpx(streams, {
      name: activityName,
      startTimeIso: new Date(startTimeLocal).toISOString(),
      activityId: stravaActivityId,
    });

    await ensureBucket(supabase);
    const gpxPath = `${athleteId}/${stravaActivityId}.gpx`;
    await supabase.storage
      .from(BUCKET)
      .upload(gpxPath, Buffer.from(gpx, 'utf8'), {
        contentType: 'application/gpx+xml',
        upsert: true,
      });
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(gpxPath);
    const strava_gpx_url = urlData.publicUrl;

    const patch: Record<string, unknown> = {
      laps: laps?.length ? laps : null,
      gps_points: gps_points.length ? gps_points : null,
      strava_gpx_url,
      // Keep streams compact — drop latlng (already in gps_points) if huge
      strava_streams: {
        time: streams.time?.data?.length ?? 0,
        heartrate: streams.heartrate?.data?.length ?? 0,
        altitude: streams.altitude?.data?.length ?? 0,
        has_latlng: !!streams.latlng?.data?.length,
      },
      has_polyline: gps_points.length > 0,
    };

    if (rowId) {
      await supabase.from('athlete_activities').update(patch).eq('id', rowId);
    } else {
      await supabase
        .from('athlete_activities')
        .update(patch)
        .eq('strava_activity_id', stravaActivityId)
        .eq('athlete_id', athleteId);
    }
  } catch (err) {
    console.warn(`enrichActivity ${stravaActivityId} failed:`, err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId = body?.athleteId as string | undefined;
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
      planMatches?: number;
      error?: string;
    }> = [];

    const isRun = (a: { type?: string; sport_type?: string }) => {
      const t = a.type || a.sport_type || '';
      return t === 'Run' || t === 'TrailRun' || t === 'VirtualRun';
    };

    for (const athlete of athletes) {
      if (!athlete.strava_auth) continue;
      try {
        const auth = decrypt(athlete.strava_auth as string) as StravaTokens;
        const token = await getValidToken(auth, athlete.id, supabase);
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

        const { data: existing } = await supabase
          .from('athlete_activities')
          .select('id, strava_activity_id, start_time, strava_gpx_url')
          .eq('athlete_id', athlete.id);

        const existingByStrava = new Map<number, { id: string; strava_gpx_url?: string | null }>();
        for (const e of existing || []) {
          if (e.strava_activity_id) {
            existingByStrava.set(e.strava_activity_id, {
              id: e.id,
              strava_gpx_url: e.strava_gpx_url,
            });
          }
        }

        let synced = 0;
        const insertErrors: string[] = [];
        // Post-workout feedback nudge (same purpose as Garmin sync's) needs
        // the newest genuinely-new activity's details after the loop below.
        const newActivityPushInfo: Array<{ activityId: number; distance: number; activityType: string; startTimeLocal: string }> = [];
        // Enrich (laps/GPX) is rate-limit heavy — only for the newest N runs.
        const ENRICH_LIMIT = 15;
        let enrichCount = 0;
        const shouldEnrich = (startLocal: string) => {
          if (enrichCount >= ENRICH_LIMIT) return false;
          const ageMs = Date.now() - new Date(startLocal).getTime();
          return ageMs < 45 * 24 * 60 * 60 * 1000; // ~45 days
        };

        for (const a of runActivities) {
          const known = existingByStrava.get(a.id);
          if (known) {
            if (!known.strava_gpx_url && shouldEnrich(a.start_date_local)) {
              enrichCount++;
              await enrichActivity(
                supabase,
                client,
                athlete.id,
                a.id,
                a.name,
                a.start_date_local,
                known.id,
              );
            }
            continue;
          }

          const durationSec = a.moving_time || a.elapsed_time;
          const distanceM = a.distance;
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
            has_polyline: !!a.map?.summary_polyline,
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
              durationSeconds: row.duration,
              averagePaceSecPerKm: row.average_pace,
              averageHr: row.average_hr,
            });
          } catch (notifyErr) {
            console.warn(`Teammate notify for Strava activity ${a.id} failed:`, notifyErr);
          }

          if (shouldEnrich(a.start_date_local)) {
            enrichCount++;
            await enrichActivity(
              supabase,
              client,
              athlete.id,
              a.id,
              a.name,
              a.start_date_local,
              inserted?.id ?? null,
            );
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

    return NextResponse.json({ synced: totalSynced, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    console.error('Strava sync error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
