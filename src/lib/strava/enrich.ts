/**
 * Strava activity enrichment: laps (or per-km splits), GPS points and a GPX
 * file for one `athlete_activities` row. Shared by the Strava sync and the
 * run chat, which enriches on demand when it opens an activity that the sync
 * has not reached yet.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from '@/lib/encryption';
import {
  StravaClient,
  hasUsefulLaps,
  refreshStravaToken,
  splitsToLaps,
  streamsToGpsPoints,
  streamsToGpx,
  tokenNeedsRefresh,
  type StravaLap,
  type StravaTokens,
} from './client';

const BUCKET = 'run-chat';

export function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /does not exist|schema cache/i.test(error.message || '')
  );
}

async function ensureBucket(supabase: SupabaseClient) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 20_000_000 });
  }
}

/** Access token for an athlete, refreshing (and persisting) when close to expiry. */
export async function getValidStravaToken(
  supabase: SupabaseClient,
  athleteId: string,
  auth: StravaTokens,
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

export interface EnrichTarget {
  athleteId: string;
  stravaActivityId: number;
  activityName: string;
  startTimeLocal: string;
  /** athlete_activities.id when known; otherwise matched by strava_activity_id. */
  rowId: string | null;
}

/**
 * Fetch laps/streams from Strava and store them on the activity row.
 * Resolves to the stored lap count, or null when enrichment failed.
 */
export async function enrichStravaActivity(
  supabase: SupabaseClient,
  client: StravaClient,
  target: EnrichTarget,
): Promise<number | null> {
  const { athleteId, stravaActivityId, activityName, startTimeLocal, rowId } = target;
  try {
    let laps = await client.getActivityLaps(stravaActivityId).catch(() => [] as StravaLap[]);
    if (!hasUsefulLaps(laps)) {
      // No laps on the watch — fall back to Strava's own per-km splits so the
      // actuals card still shows a breakdown instead of one big block.
      try {
        const detail = await client.getActivity(stravaActivityId);
        const fromSplits = splitsToLaps(detail.splits_metric);
        if (fromSplits.length) laps = fromSplits;
      } catch (detailErr) {
        console.warn(`Strava detail for ${stravaActivityId} unavailable:`, detailErr);
      }
    }

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

    // `[]` (not null) when Strava has nothing, so callers know the run was
    // already looked at and do not burn API calls re-enriching it.
    const storedLaps = laps?.length ? laps : [];
    const corePatch: Record<string, unknown> = {
      laps: storedLaps,
      gps_points: gps_points.length ? gps_points : null,
      has_polyline: gps_points.length > 0,
    };
    const patch: Record<string, unknown> = {
      ...corePatch,
      strava_gpx_url,
      // Keep streams compact — drop latlng (already in gps_points) if huge
      strava_streams: {
        time: streams.time?.data?.length ?? 0,
        heartrate: streams.heartrate?.data?.length ?? 0,
        altitude: streams.altitude?.data?.length ?? 0,
        has_latlng: !!streams.latlng?.data?.length,
      },
    };

    const applyPatch = (values: Record<string, unknown>) => {
      const query = supabase.from('athlete_activities').update(values);
      return rowId
        ? query.eq('id', rowId)
        : query.eq('strava_activity_id', stravaActivityId).eq('athlete_id', athleteId);
    };

    let { error } = await applyPatch(patch);
    if (error && isMissingColumnError(error)) {
      // Migration 051 (strava_gpx_url / strava_streams) not applied yet —
      // laps and the route are what the run chat needs; store those anyway.
      ({ error } = await applyPatch(corePatch));
    }
    if (error) {
      console.warn(`enrichStravaActivity ${stravaActivityId} update failed:`, error.message);
      return null;
    }
    return storedLaps.length;
  } catch (err) {
    console.warn(`enrichStravaActivity ${stravaActivityId} failed:`, err);
    return null;
  }
}

/**
 * On-demand enrichment for a single activity row (run chat opening a Strava
 * run the hourly sync has not reached). Resolves true when laps were stored.
 */
export async function enrichActivityRowFromStrava(
  supabase: SupabaseClient,
  activity: {
    id: string;
    athlete_id?: string | null;
    strava_activity_id?: number | null;
    activity_name?: string | null;
    start_time?: string | null;
  },
): Promise<boolean> {
  if (!activity.strava_activity_id) return false;

  let athleteId = activity.athlete_id ?? null;
  if (!athleteId) {
    const { data } = await supabase
      .from('athlete_activities')
      .select('athlete_id')
      .eq('id', activity.id)
      .maybeSingle();
    athleteId = (data?.athlete_id as string | undefined) ?? null;
  }
  if (!athleteId) return false;

  const { data: athlete } = await supabase
    .from('athletes')
    .select('strava_auth')
    .eq('id', athleteId)
    .maybeSingle();
  if (!athlete?.strava_auth) return false;

  const auth = decrypt(athlete.strava_auth as string) as StravaTokens;
  const token = await getValidStravaToken(supabase, athleteId, auth);
  if (!token) return false;

  const stored = await enrichStravaActivity(supabase, new StravaClient(token), {
    athleteId,
    stravaActivityId: activity.strava_activity_id,
    activityName: activity.activity_name || 'Run',
    startTimeLocal: activity.start_time || new Date().toISOString(),
    rowId: activity.id,
  });
  return stored !== null;
}
