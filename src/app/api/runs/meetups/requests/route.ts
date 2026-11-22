import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { notifyAthlete } from '@/lib/push';
import { meetupJoinedCopy, meetupAcceptedCopy, meetupRequestCopy, meetupPromotedCopy } from '@/lib/notifications/copy';
import { israelToday } from '@/lib/utils';
import { isUpcomingMeetup } from '@/lib/runs/meetups';
import { rosterFull, factsFor, visibleTo, type MeetupRow, type RequestRow } from '@/lib/runs/meetups-server';
import { decideJoin, nextFromWaitlist, parseVisibility } from '@/lib/runs/together';

export const dynamic = 'force-dynamic';

/**
 * Joining, leaving and the host answering. Every verb derives its actor from the
 * session — never an id in the body.
 *
 * v3 (migration 190): club/squad joins are instant, private runs wait on the host,
 * a full run waitlists. Capacity is enforced with insert-then-recount: two people
 * taking the last place at once both insert 'accepted', both re-read the accepted rows
 * ordered by created_at, and whoever is past capacity demotes THEMSELVES to the
 * waitlist — so the run never ends up over capacity without a lock.
 */

const MEETUP_URL = '/dashboard/run-together';
type Db = ReturnType<typeof createServerClient>;

async function loadRun(db: Db, meetupId: string) {
  const [{ data: meetup }, { data: reqs }, inv] = await Promise.all([
    db.from('run_meetups').select('*').eq('id', meetupId).maybeSingle(),
    db.from('run_meetup_requests').select('id, meetup_id, athlete_id, status, created_at').eq('meetup_id', meetupId),
    db.from('run_meetup_invites').select('meetup_id, athlete_id').eq('meetup_id', meetupId),
  ]);
  return { meetup: meetup as MeetupRow | null, reqs: (reqs || []) as RequestRow[], invites: inv.error ? [] : (inv.data || []) as Array<{ meetup_id: string; athlete_id: string }> };
}

/** Re-count after an insert; anyone accepted past capacity (by created_at) goes to the waitlist. */
async function enforceCapacity(db: Db, m: MeetupRow, athleteId: string): Promise<'accepted' | 'waitlist'> {
  if (m.capacity == null) return 'accepted';
  const { data } = await db.from('run_meetup_requests').select('athlete_id, created_at, id').eq('meetup_id', m.id).eq('status', 'accepted').order('created_at').order('id');
  const order = ((data || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id).filter((a) => a !== m.host_athlete_id);
  const places = m.capacity - 1; // the host holds one
  if (order.indexOf(athleteId) < places) return 'accepted';
  await db.from('run_meetup_requests').update({ status: 'waitlist' }).eq('meetup_id', m.id).eq('athlete_id', athleteId);
  return 'waitlist';
}

// POST /api/runs/meetups/requests { meetupId } → { status: 'accepted' | 'pending' | 'waitlist' }
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json().catch(() => ({}));
    const meetupId = typeof body.meetupId === 'string' ? body.meetupId.trim() : '';
    if (!meetupId) return NextResponse.json({ error: 'meetupId is required' }, { status: 400 });
    const me = auth.user.athleteId;
    const db = createServerClient();
    const { meetup, reqs, invites } = await loadRun(db, meetupId);
    if (!meetup) return NextResponse.json({ error: 'No such meetup' }, { status: 404 });
    const ros = await rosterFull(db);
    const f = factsFor(meetup, reqs, invites, me);
    if (!visibleTo(meetup, f, { id: me, groupId: ros.groupOf.get(me) ?? null }, ros.groupOf.get(meetup.host_athlete_id))) return NextResponse.json({ error: 'No such meetup' }, { status: 404 });
    if (!isUpcomingMeetup({ date: meetup.date, status: meetup.status }, israelToday())) {
      return NextResponse.json({ error: 'This run is no longer open' }, { status: 409 });
    }
    if (meetup.host_athlete_id === me) return NextResponse.json({ error: 'You are the host' }, { status: 400 });
    // Idempotent: already in (or already asked / queued) → same answer, no second push.
    if (f.myStatus === 'accepted' || f.myStatus === 'pending' || f.myStatus === 'waitlist') return NextResponse.json({ status: f.myStatus });
    // A host's "no" is not reopened by asking again.
    if (f.myStatus === 'declined') return NextResponse.json({ status: 'declined' });

    const visibility = parseVisibility(meetup.visibility, meetup.audience);
    let status: 'accepted' | 'pending' | 'waitlist' = decideJoin({ visibility, capacity: meetup.capacity ?? null, acceptedCount: f.joinedIds.length });
    // created_at reset so a re-join after leaving queues at the back.
    const { error } = await db.from('run_meetup_requests').upsert(
      { meetup_id: meetupId, athlete_id: me, status, created_at: new Date().toISOString() },
      { onConflict: 'meetup_id,athlete_id' },
    );
    if (error) {
      // Pre-190 the status check refuses 'waitlist': join as before.
      if (status === 'waitlist') {
        status = 'accepted';
        const r2 = await db.from('run_meetup_requests').upsert({ meetup_id: meetupId, athlete_id: me, status }, { onConflict: 'meetup_id,athlete_id' });
        if (r2.error) throw r2.error;
      } else throw error;
    }
    if (status === 'accepted') status = await enforceCapacity(db, meetup, me);

    if (status !== 'waitlist') {
      try {
        const person = ros.people.get(me);
        await notifyAthlete({
          athleteId: meetup.host_athlete_id, kind: status === 'pending' ? 'meetup_request' : 'meetup_joined', actorAthleteId: me,
          url: `${MEETUP_URL}/${meetupId}`, tag: `meetup-join-${meetupId}`, category: 'teammates', icon: person?.avatarUrl || undefined,
          copy: (locale) => status === 'pending'
            ? meetupRequestCopy(locale, { name: person?.name, date: meetup.date, startTime: meetup.start_time })
            : meetupJoinedCopy(locale, { name: person?.name, date: meetup.date, startTime: meetup.start_time, place: meetup.location, going: f.joinedIds.length + 2, today: israelToday() }),
        });
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ status });
  } catch (err: unknown) {
    console.error('Meetup request error:', err);
    return NextResponse.json({ error: 'Failed to send request' }, { status: 500 });
  }
}

// DELETE /api/runs/meetups/requests?meetupId=<id> — leave (or withdraw an ask / leave the
// waitlist). A place that opens goes to the first waitlister, who is pushed.
export async function DELETE(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const meetupId = (new URL(request.url).searchParams.get('meetupId') || '').trim();
    if (!meetupId) return NextResponse.json({ error: 'meetupId is required' }, { status: 400 });
    const db = createServerClient();
    const me = auth.user.athleteId;
    let { error } = await db.from('run_meetup_requests').update({ status: 'left' }).eq('meetup_id', meetupId).eq('athlete_id', me);
    // Pre-190 'left' isn't allowed: delete as before.
    if (error) ({ error } = await db.from('run_meetup_requests').delete().eq('meetup_id', meetupId).eq('athlete_id', me));
    if (error) throw error;

    const { meetup, reqs } = await loadRun(db, meetupId);
    if (meetup && meetup.status === 'open' && meetup.date >= israelToday()) {
      const next = nextFromWaitlist(reqs.map((r) => ({ athleteId: r.athlete_id, status: r.status, createdAt: r.created_at || '' })), meetup.capacity ?? null);
      if (next) {
        const { data: moved } = await db.from('run_meetup_requests').update({ status: 'accepted' })
          .eq('meetup_id', meetupId).eq('athlete_id', next).eq('status', 'waitlist').select('id');
        if (moved?.length) {
          await notifyAthlete({
            athleteId: next, kind: 'meetup_promoted', url: `${MEETUP_URL}/${meetupId}`, tag: `meetup-${meetupId}`, category: 'teammates',
            copy: (locale) => meetupPromotedCopy(locale, { startTime: meetup.start_time, title: locale === 'he' ? 'הריצה' : 'The run' }),
          }).catch(() => {});
        }
      }
    }
    return NextResponse.json({ status: null });
  } catch (err: unknown) {
    console.error('Meetup request withdraw error:', err);
    return NextResponse.json({ error: 'Failed to withdraw request' }, { status: 500 });
  }
}

// PATCH /api/runs/meetups/requests { requestId, status: 'accepted' | 'declined' } — the host answers (private runs).
export async function PATCH(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json().catch(() => ({}));
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    // Or by athlete — the native host sheet knows people, not request ids.
    const meetupIdIn = typeof body.meetupId === 'string' ? body.meetupId.trim() : '';
    const athleteIdIn = typeof body.athleteId === 'string' ? body.athleteId.trim() : '';
    const status = body.status === 'accepted' || body.status === 'declined' ? body.status : null;
    if ((!requestId && !(meetupIdIn && athleteIdIn)) || !status) {
      return NextResponse.json({ error: 'requestId (or meetupId + athleteId) and a valid status are required' }, { status: 400 });
    }
    const db = createServerClient();
    let q = db.from('run_meetup_requests').select('id, athlete_id, meetup_id');
    q = requestId ? q.eq('id', requestId) : q.eq('meetup_id', meetupIdIn).eq('athlete_id', athleteIdIn);
    const { data: reqRow, error: reqError } = await q.maybeSingle();
    if (reqError) throw reqError;
    if (!reqRow) return NextResponse.json({ error: 'No such request' }, { status: 404 });
    const { data: meetup } = await db.from('run_meetups').select('*').eq('id', reqRow.meetup_id).maybeSingle();
    const m = meetup as MeetupRow | null;
    if (!m || m.host_athlete_id !== auth.user.athleteId) return NextResponse.json({ error: 'Not your meetup' }, { status: 403 });

    const { error } = await db.from('run_meetup_requests').update({ status }).eq('id', reqRow.id);
    if (error) throw error;
    let final: string = status;
    if (status === 'accepted') final = await enforceCapacity(db, m, reqRow.athlete_id);

    // Accepting notifies; declining does not (a person, not a system, saying no).
    if (final === 'accepted') {
      try {
        const { data: host } = await db.from('athletes').select('name').eq('id', auth.user.athleteId).maybeSingle();
        await notifyAthlete({
          athleteId: reqRow.athlete_id, kind: 'meetup_accepted', actorAthleteId: auth.user.athleteId,
          url: `${MEETUP_URL}/${m.id}`, tag: `meetup-accepted-${m.id}`, category: 'teammates',
          copy: (locale) => meetupAcceptedCopy(locale, { name: host?.name, date: m.date, startTime: m.start_time, location: m.location }),
        });
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ status: final });
  } catch (err: unknown) {
    console.error('Meetup answer error:', err);
    return NextResponse.json({ error: 'Failed to answer request' }, { status: 500 });
  }
}
