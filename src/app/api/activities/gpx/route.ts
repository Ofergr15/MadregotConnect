import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { GPX_BUCKET, gpxPathOf } from '@/lib/strava/gpx-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/activities/gpx?activityId=<uuid> — the run's GPX, for its owner.
 *
 * The file is in a private bucket (lib/strava/gpx-store). This answers with a link to it
 * that lasts a minute, and only for the runner whose run it is, or the super user (support).
 * Strava's terms show a member's data to that member — so not to their coach or pack.
 */
export async function GET(request: Request) {
  const activityId = new URL(request.url).searchParams.get('activityId');
  if (!activityId || !/^[0-9a-f-]{36}$/i.test(activityId)) return NextResponse.json({ error: 'activityId (uuid) required' }, { status: 400 });
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const { data: row } = await supabase.from('athlete_activities').select('athlete_id, strava_gpx_url').eq('id', activityId).maybeSingle();
  if (!row || (row.athlete_id !== caller.athleteId && !caller.isSuperUser)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const path = gpxPathOf(row.strava_gpx_url);
  if (!path) return NextResponse.json({ error: 'No GPX' }, { status: 404 });
  const { data, error } = await supabase.storage.from(GPX_BUCKET).createSignedUrl(path, 60, { download: 'activity.gpx' });
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'No GPX' }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { 'Cache-Control': 'private, no-store' } });
}
