import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import {
  validateMeetupDraft,
  isUpcomingMeetup,
  sortMeetups,
  type RunMeetup,
  type MeetupRequestStatus,
} from '@/lib/runs/meetups';

export const dynamic = 'force-dynamic';

/**
 * The run-meetup board — "שידוכי ריצות" (398963c7). See lib/runs/meetups.ts for
 * the rules and migration 107 for why this is not the club calendar.
 *
 * ── WHAT A MEMBER SEES ──────────────────────────────────────────────────────
 * `requireMember` on the read, the same gate as /api/groups/standings. An offer
 * is meant to be read by the club — that is the entire point of posting one — and
 * it carries nothing that isn't already on a feed card: a name, a place, a time.
 * The one thing that is NOT club-visible is who ASKED to join: a pending request
 * goes to the host only, so being turned down isn't a public event. Accepted
 * joiners are visible, because they are going on the run.
 *
 * Writes use `requireAthlete` (a real session JWT with an active athlete row).
 * The host is taken from that session and never from the body.
 */

interface MeetupRow {
  id: string;
  host_athlete_id: string;
  date: string;
  start_time: string;
  location: string;
  planned_pace: string | null;
  distance_km: number | null;
  notes: string | null;
  status: string;
}

interface RequestRow {
  id: string;
  meetup_id: string;
  athlete_id: string;
  status: string;
}

// GET /api/runs/meetups → { meetups: RunMeetup[], today }
export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;

  try {
    // The viewer's own athlete id decides two things: which meetups are theirs to
    // manage, and which pending requests they may see. A caller that passes the
    // member gate but has no athlete row (staff without one) simply sees the
    // board as a reader.
    const auth = await requireAthlete(request);
    const viewerId = auth.ok ? auth.user.athleteId : null;

    const supabase = createServerClient();
    const today = israelToday();

    const { data: rows, error } = await supabase
      .from('run_meetups')
      .select('id, host_athlete_id, date, start_time, location, planned_pace, distance_km, notes, status')
      .gte('date', today)
      .eq('status', 'open')
      .order('date', { ascending: true });
    if (error) throw error;

    const meetupRows = (rows || []) as MeetupRow[];
    if (meetupRows.length === 0) return NextResponse.json({ meetups: [], today });

    const [requestsRes, namesRes] = await Promise.all([
      supabase
        .from('run_meetup_requests')
        .select('id, meetup_id, athlete_id, status')
        .in('meetup_id', meetupRows.map(m => m.id)),
      // Names for hosts and joiners in one read. `athletes.name` is the roster
      // name every member already has through /api/groups — no emails here.
      supabase.from('athletes').select('id, name'),
    ]);
    if (requestsRes.error) throw requestsRes.error;

    const nameById = new Map<string, string>(
      (namesRes.data || []).map((a: { id: string; name: string | null }) => [a.id, (a.name || '').trim()]),
    );
    const requestRows = (requestsRes.data || []) as RequestRow[];

    const meetups: RunMeetup[] = sortMeetups(
      meetupRows
        .filter(m => isUpcomingMeetup({ date: m.date, status: m.status }, today))
        .map(m => {
          const mine = requestRows.filter(r => r.meetup_id === m.id);
          const isHost = !!viewerId && viewerId === m.host_athlete_id;
          return {
            id: m.id,
            hostAthleteId: m.host_athlete_id,
            hostName: nameById.get(m.host_athlete_id) || '',
            date: m.date,
            startTime: m.start_time,
            location: m.location,
            plannedPace: m.planned_pace,
            distanceKm: m.distance_km === null ? null : Number(m.distance_km),
            notes: m.notes,
            status: 'open' as const,
            accepted: mine
              .filter(r => r.status === 'accepted')
              .map(r => ({ athleteId: r.athlete_id, name: nameById.get(r.athlete_id) || '' })),
            // Host-only, deliberately: a request nobody answered yet is between
            // the two of them.
            pending: isHost
              ? mine
                  .filter(r => r.status === 'pending')
                  .map(r => ({ athleteId: r.athlete_id, name: nameById.get(r.athlete_id) || '', requestId: r.id }))
              : [],
            myRequest:
              (mine.find(r => viewerId && r.athlete_id === viewerId)?.status as MeetupRequestStatus | undefined) ?? null,
            isHost,
          };
        }),
    );

    return NextResponse.json({ meetups, today });
  } catch (err: unknown) {
    console.error('Meetups fetch error:', err);
    return NextResponse.json({ error: 'Failed to load meetups' }, { status: 500 });
  }
}

// POST /api/runs/meetups { date, startTime, location, plannedPace?, distanceKm?, notes? }
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = validateMeetupDraft(body, israelToday());
    // The field travels with the error so the sheet can point at the input that
    // is wrong instead of showing one generic failure over five of them.
    if (!parsed.ok) {
      return NextResponse.json({ error: 'invalid', field: parsed.field, reason: parsed.reason }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('run_meetups')
      .insert({
        host_athlete_id: auth.user.athleteId,
        date: parsed.value.date,
        start_time: parsed.value.startTime,
        location: parsed.value.location,
        planned_pace: parsed.value.plannedPace,
        distance_km: parsed.value.distanceKm,
        notes: parsed.value.notes,
      })
      .select('id')
      .single();
    if (error) throw error;

    return NextResponse.json({ id: data.id });
  } catch (err: unknown) {
    console.error('Meetup create error:', err);
    return NextResponse.json({ error: 'Failed to create meetup' }, { status: 500 });
  }
}

// DELETE /api/runs/meetups?id=<id>
// Cancels rather than deletes: somebody may already have been accepted onto it,
// and their notification saying so should not point at a row that is gone.
export async function DELETE(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const id = (new URL(request.url).searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();
    // The host filter is part of the UPDATE, not a check before it: two
    // statements leave a window, and one statement that matches no row is
    // exactly the 404 this should return anyway.
    const { data, error } = await supabase
      .from('run_meetups')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('host_athlete_id', auth.user.athleteId)
      .select('id');
    if (error) throw error;
    if ((data || []).length === 0) {
      return NextResponse.json({ error: 'Not your meetup' }, { status: 403 });
    }

    return NextResponse.json({ cancelled: true });
  } catch (err: unknown) {
    console.error('Meetup cancel error:', err);
    return NextResponse.json({ error: 'Failed to cancel meetup' }, { status: 500 });
  }
}
