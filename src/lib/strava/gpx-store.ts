import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * WHERE A RUN'S GPX LIVES (legal review 2026-10-19, item 4; built 2026-10-21).
 *
 * The routes Strava's streams are turned into sat in the PUBLIC `run-chat` bucket, so
 * anyone with the link could download where a member runs — from home, mostly. They now
 * live in the private `run-gpx` bucket, under the same path (<athleteId>/<stravaId>.gpx),
 * and `athlete_activities.strava_gpx_url` holds a reference ("storage:run-gpx/<path>"),
 * never a link. Downloads go through /api/activities/gpx: the run's owner only (Strava's
 * terms — a member's data is shown to that member), as a link that lasts a minute.
 * A row still holding an old public link is read by the same path.
 */
export const GPX_BUCKET = 'run-gpx';
const REF = `storage:${GPX_BUCKET}/`;
const LEGACY = '/storage/v1/object/public/run-chat/';

export async function ensureGpxBucket(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.storage.getBucket(GPX_BUCKET);
  if (!data) await supabase.storage.createBucket(GPX_BUCKET, { public: false, fileSizeLimit: 20_000_000 });
}

/** The value stored on the row for a GPX at `path`. */
export const gpxRef = (path: string) => `${REF}${path}`;

/** The path inside the private bucket, from a reference or from an old public link. */
export function gpxPathOf(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.startsWith(REF)) return stored.slice(REF.length) || null;
  const i = stored.indexOf(LEGACY);
  return i >= 0 ? decodeURIComponent(stored.slice(i + LEGACY.length).split('?')[0]) || null : null;
}

/** The GPX itself, for the server (the run-chat coach); null when it isn't there. */
export async function readGpx(supabase: SupabaseClient, stored: string | null | undefined): Promise<string | null> {
  const path = gpxPathOf(stored);
  if (!path) return null;
  const { data, error } = await supabase.storage.from(GPX_BUCKET).download(path);
  if (error || !data) return null;
  return data.text();
}

/** Where a member's app downloads it: the gated route, never the bucket. */
export const gpxHref = (activityId: string) => `/api/activities/gpx?activityId=${encodeURIComponent(activityId)}`;
