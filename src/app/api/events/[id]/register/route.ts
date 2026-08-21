import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import type { EventRegistrationStatus } from '@/lib/events';

export const dynamic = 'force-dynamic';

async function capacitySummary(
  supabase: ReturnType<typeof createServerClient>,
  eventId: string,
  capacity: number | null,
) {
  const [{ count: registeredCount }, { count: waitlistCount }] = await Promise.all([
    supabase
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'registered'),
    supabase
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'waitlisted'),
  ]);
  return {
    registeredCount: registeredCount || 0,
    waitlistCount: waitlistCount || 0,
    capacity,
  };
}

// POST /api/events/[id]/register — the caller registers themselves.
//
// Security: always uses the authenticated athlete's own id from
// requireAthlete(), never a client-supplied athleteId — otherwise anyone
// could register (or bump) another member's spot.
//
// Waitlist gate: counts OTHER athletes' current `registered` rows against
// capacity (excludes the caller's own row), so re-registering after a cancel
// never wrongly waitlists someone due to their own stale prior row. Re-
// registering also refreshes `created_at`, so a lapsed member who rejoins the
// waitlist queues behind existing waitlisted members rather than jumping the
// line on an old timestamp.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const { id: eventId } = await params;
    const supabase = createServerClient();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, capacity')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const { count: othersRegistered, error: countError } = await supabase
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'registered')
      .neq('athlete_id', auth.user.athleteId);
    if (countError) throw countError;

    const hasRoom = event.capacity == null || (othersRegistered || 0) < event.capacity;
    const status: EventRegistrationStatus = hasRoom ? 'registered' : 'waitlisted';

    const { data: registration, error } = await supabase
      .from('event_registrations')
      .upsert(
        {
          event_id: eventId,
          athlete_id: auth.user.athleteId,
          status,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,athlete_id' },
      )
      .select('id, event_id, athlete_id, status, created_at')
      .single();
    if (error) throw error;

    const summary = await capacitySummary(supabase, eventId, event.capacity);

    return NextResponse.json({
      registration: {
        id: registration.id,
        eventId: registration.event_id,
        athleteId: registration.athlete_id,
        status: registration.status,
        createdAt: registration.created_at,
      },
      ...summary,
    });
  } catch (error) {
    console.error('Failed to register for event:', error);
    return NextResponse.json({ error: 'Failed to register for event' }, { status: 500 });
  }
}

// DELETE /api/events/[id]/register — the caller cancels their own
// registration (`status='cancelled'`). If they were actually `registered`
// (not just `waitlisted`) and the event has a capacity, promotes the oldest
// `waitlisted` row (by created_at) into the freed `registered` spot — the
// "spot opens up" promotion described in the migration's schema comment.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const { id: eventId } = await params;
    const supabase = createServerClient();

    const [
      { data: existing, error: existingError },
      { data: event, error: eventError },
    ] = await Promise.all([
      supabase
        .from('event_registrations')
        .select('id, status')
        .eq('event_id', eventId)
        .eq('athlete_id', auth.user.athleteId)
        .maybeSingle(),
      supabase.from('events').select('capacity').eq('id', eventId).maybeSingle(),
    ]);
    if (existingError) throw existingError;
    if (eventError) throw eventError;
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!existing || existing.status === 'cancelled') {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    const { error: cancelError } = await supabase
      .from('event_registrations')
      .update({ status: 'cancelled' })
      .eq('id', existing.id);
    if (cancelError) throw cancelError;

    let promotedAthleteId: string | null = null;
    // Only cancelling a truly `registered` row frees a real spot; cancelling
    // a `waitlisted` row changes nothing capacity-wise.
    if (existing.status === 'registered' && event.capacity != null) {
      const { data: nextInLine } = await supabase
        .from('event_registrations')
        .select('id, athlete_id')
        .eq('event_id', eventId)
        .eq('status', 'waitlisted')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextInLine) {
        const { error: promoteError } = await supabase
          .from('event_registrations')
          .update({ status: 'registered' })
          .eq('id', nextInLine.id);
        if (promoteError) throw promoteError;
        promotedAthleteId = nextInLine.athlete_id;
      }
    }

    const summary = await capacitySummary(supabase, eventId, event.capacity);
    return NextResponse.json({ success: true, promotedAthleteId, ...summary });
  } catch (error) {
    console.error('Failed to cancel event registration:', error);
    return NextResponse.json({ error: 'Failed to cancel event registration' }, { status: 500 });
  }
}
