import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { notifyAthlete } from '@/lib/push';
import { meetupRequestCopy, meetupAcceptedCopy } from '@/lib/notifications/copy';
import { israelToday } from '@/lib/utils';
import { isUpcomingMeetup } from '@/lib/runs/meetups';

export const dynamic = 'force-dynamic';

/**
 * Asking to join a run, and the host answering (398963c7).
 *
 * Every verb here derives its actor from the session — the requester on POST and
 * DELETE, the host on PATCH — so there is no id in a body that decides who is
 * allowed to do something. The host check on PATCH is a filter inside the UPDATE
 * rather than a read-then-write, so there is no window between the two.
 */

const MEETUP_URL = '/dashboard/run-together';

// POST /api/runs/meetups/requests { meetupId }
// Ask to join. Idempotent: asking again is a no-op, and in particular it does NOT
// re-notify the host or resurrect a request they already declined.
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const body = await request.json().catch(() => ({}));
    const meetupId = typeof body.meetupId === 'string' ? body.meetupId.trim() : '';
    if (!meetupId) return NextResponse.json({ error: 'meetupId is required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: meetup, error: meetupError } = await supabase
      .from('run_meetups')
      .select('id, host_athlete_id, date, start_time, location, status')
      .eq('id', meetupId)
      .maybeSingle();
    if (meetupError) throw meetupError;
    if (!meetup) return NextResponse.json({ error: 'No such meetup' }, { status: 404 });

    // A run that already happened, or one the host called off. Refused here so
    // the answer is a reason and not a request that silently never gets answered.
    if (!isUpcomingMeetup({ date: meetup.date, status: meetup.status }, israelToday())) {
      return NextResponse.json({ error: 'This run is no longer open' }, { status: 409 });
    }
    if (meetup.host_athlete_id === auth.user.athleteId) {
      return NextResponse.json({ error: 'You are the host' }, { status: 400 });
    }

    const { data: inserted, error } = await supabase
      .from('run_meetup_requests')
      .upsert(
        { meetup_id: meetupId, athlete_id: auth.user.athleteId },
        { onConflict: 'meetup_id,athlete_id', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw error;

    // Only a genuinely new row notifies — same test as the follow route uses, and
    // for the same reason: a host should not get the same "wants to join" twice
    // because somebody's phone retried.
    if ((inserted || []).length > 0) {
      try {
        const { data: me } = await supabase
          .from('athletes')
          .select('name')
          .eq('id', auth.user.athleteId)
          .maybeSingle();
        await notifyAthlete({
          athleteId: meetup.host_athlete_id,
          kind: 'meetup_request',
          actorAthleteId: auth.user.athleteId,
          url: MEETUP_URL,
          tag: `meetup-request-${meetupId}`,
          category: 'teammates',
          copy: locale =>
            meetupRequestCopy(locale, { name: me?.name, date: meetup.date, startTime: meetup.start_time }),
        });
      } catch { /* push is best-effort and never blocks the request itself */ }
    }

    return NextResponse.json({ status: 'pending' });
  } catch (err: unknown) {
    console.error('Meetup request error:', err);
    return NextResponse.json({ error: 'Failed to send request' }, { status: 500 });
  }
}

// DELETE /api/runs/meetups/requests?meetupId=<id>
// Withdraw your own request. The host is not told — somebody changing their mind
// before the run is not an event worth a push.
export async function DELETE(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const meetupId = (new URL(request.url).searchParams.get('meetupId') || '').trim();
    if (!meetupId) return NextResponse.json({ error: 'meetupId is required' }, { status: 400 });

    const supabase = createServerClient();
    const { error } = await supabase
      .from('run_meetup_requests')
      .delete()
      .eq('meetup_id', meetupId)
      .eq('athlete_id', auth.user.athleteId);
    if (error) throw error;

    return NextResponse.json({ status: null });
  } catch (err: unknown) {
    console.error('Meetup request withdraw error:', err);
    return NextResponse.json({ error: 'Failed to withdraw request' }, { status: 500 });
  }
}

// PATCH /api/runs/meetups/requests { requestId, status: 'accepted' | 'declined' }
// The host answers.
export async function PATCH(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    const status = body.status === 'accepted' || body.status === 'declined' ? body.status : null;
    if (!requestId || !status) {
      return NextResponse.json({ error: 'requestId and a valid status are required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Load the request WITH its meetup so the host check and the notification copy
    // come from one read.
    const { data: reqRow, error: reqError } = await supabase
      .from('run_meetup_requests')
      .select('id, athlete_id, meetup_id, run_meetups!inner(id, host_athlete_id, date, start_time, location)')
      .eq('id', requestId)
      .maybeSingle();
    if (reqError) throw reqError;
    if (!reqRow) return NextResponse.json({ error: 'No such request' }, { status: 404 });

    const meetup = reqRow.run_meetups as unknown as {
      host_athlete_id: string;
      date: string;
      start_time: string;
      location: string;
    };
    if (meetup.host_athlete_id !== auth.user.athleteId) {
      return NextResponse.json({ error: 'Not your meetup' }, { status: 403 });
    }

    const { error } = await supabase.from('run_meetup_requests').update({ status }).eq('id', requestId);
    if (error) throw error;

    // Accepting notifies; declining does not. A "no" that arrives on a lock
    // screen is a worse version of the same information the board already shows,
    // and in a 24-person club it is a person, not a system, saying it.
    if (status === 'accepted') {
      try {
        const { data: host } = await supabase
          .from('athletes')
          .select('name')
          .eq('id', auth.user.athleteId)
          .maybeSingle();
        await notifyAthlete({
          athleteId: reqRow.athlete_id,
          kind: 'meetup_accepted',
          actorAthleteId: auth.user.athleteId,
          url: MEETUP_URL,
          tag: `meetup-accepted-${reqRow.meetup_id}`,
          category: 'teammates',
          copy: locale =>
            meetupAcceptedCopy(locale, {
              name: host?.name,
              date: meetup.date,
              startTime: meetup.start_time,
              location: meetup.location,
            }),
        });
      } catch { /* best-effort */ }
    }

    return NextResponse.json({ status });
  } catch (err: unknown) {
    console.error('Meetup answer error:', err);
    return NextResponse.json({ error: 'Failed to answer request' }, { status: 500 });
  }
}
