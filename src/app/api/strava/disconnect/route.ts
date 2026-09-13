import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * POST /api/strava/disconnect
 * Body: { athleteId: string }
 *
 * Unlinks a Strava account from an athlete. Until this existed there was no way
 * out of a bad link at all — a member who authorised the wrong Strava account had
 * to have it cleared by hand in the database, which is how Yosi Sabag spent eight
 * weeks connected to an empty account nobody could see was empty. Fixing your own
 * mistake should not require the coach and a SQL editor.
 *
 * Self-or-staff: your own link, or a coach unlinking anyone's.
 *
 * Three fields are cleared and three are deliberately left alone:
 *
 *   strava_enabled STAYS TRUE. It is not a record of being connected — it is the
 *     admin's permission for this athlete to use Strava at all, and the profile
 *     screen gates the entire Strava section on `stravaEnabled || hasStrava`
 *     (profile/page.tsx). Clearing it here would hide the very button the member
 *     needs to connect the RIGHT account, turning an undo into a dead end.
 *
 *   athlete_activities are NOT deleted. Rows already imported are the member's own
 *     history, they are indistinguishable from Garmin's copies after dedupe, and
 *     badges, challenges and shoe mileage are all summed off them. Unlinking a
 *     source is not a request to erase a year of running.
 *
 *   data_source moves to 'garmin' ONLY when Garmin is actually connected. It
 *     decides which sync cron owns this athlete, so leaving it on 'strava' with no
 *     Strava token points them at a source that cannot answer; but flipping it to
 *     Garmin when there is no Garmin either would be just as false.
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
    .select('id, data_source, garmin_auth, strava_athlete_id')
    .eq('id', athleteId)
    .maybeSingle();

  if (!athlete) {
    return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('athletes')
    .update({
      strava_auth: null,
      strava_athlete_id: null,
      // Otherwise the profile screen keeps reporting a successful sync from a
      // source that is no longer connected.
      strava_last_sync_at: null,
      strava_auth_failed_at: null,
      ...(athlete.garmin_auth && athlete.data_source === 'strava' ? { data_source: 'garmin' } : {}),
    })
    .eq('id', athleteId);

  if (error) {
    console.error('Strava disconnect failed:', error);
    return NextResponse.json({ error: 'failed to disconnect' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    // What was unlinked, so a coach doing this for someone else can see it landed
    // on the account they meant.
    unlinkedStravaAthleteId: athlete.strava_athlete_id ?? null,
  });
}
