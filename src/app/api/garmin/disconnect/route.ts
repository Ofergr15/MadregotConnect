import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * POST /api/garmin/disconnect
 * Body: { athleteId: string }
 *
 * Unlinks Garmin from an athlete — the Garmin twin of POST /api/strava/disconnect,
 * with the same rules and for the same reason: getting out of a bad link should
 * not need a coach and a SQL editor.
 *
 * Self-or-staff: your own link, or a coach unlinking anyone's.
 *
 * Cleared: the stored (encrypted) token and the three timestamps that describe it,
 * so the profile stops reporting a sync from a source that is gone.
 *
 * Deliberately NOT touched:
 *   athlete_activities — the member's own history; badges, challenges and shoe
 *     mileage are summed off it. Unlinking a source is not a request to erase it.
 *   workouts already on the watch — they live on the device and in Garmin Connect.
 *     The unofficial API has no revoke call either, so the member removes the app's
 *     access in Garmin Connect themselves if they want it gone there too.
 *   data_source moves to 'strava' ONLY when Strava is actually connected; with no
 *     Strava either, pointing the sync at it would be just as false.
 *
 * Columns from later migrations (garmin_authed_at, garmin_last_sync_at,
 * garmin_auth_failed_at) are applied by hand; on a database without them the
 * update falls back to the token alone rather than failing the unlink.
 */
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const athleteId = typeof body?.athleteId === 'string' ? body.athleteId : null;
  if (!athleteId) {
    return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  }

  const { denied } = await requireCallerForAthlete(request, athleteId);
  if (denied) return denied;

  const supabase = createServerClient();
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, data_source, garmin_auth, strava_auth')
    .eq('id', athleteId)
    .maybeSingle();

  if (!athlete) {
    return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
  }

  const wasConnected = !!athlete.garmin_auth;
  const sourceMove = athlete.strava_auth && athlete.data_source === 'garmin' ? { data_source: 'strava' } : {};

  let { error } = await supabase
    .from('athletes')
    .update({
      garmin_auth: null,
      garmin_authed_at: null,
      garmin_last_sync_at: null,
      garmin_auth_failed_at: null,
      ...sourceMove,
    })
    .eq('id', athleteId);
  if (error && (error as { code?: string }).code === '42703') {
    ({ error } = await supabase.from('athletes').update({ garmin_auth: null, ...sourceMove }).eq('id', athleteId));
  }

  if (error) {
    console.error('Garmin disconnect failed:', error);
    return NextResponse.json({ error: 'failed to disconnect' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, wasConnected, dataSource: sourceMove.data_source ?? athlete.data_source ?? null });
}
