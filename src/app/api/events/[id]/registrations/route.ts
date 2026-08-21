import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

interface RawRegistration {
  athlete_id: string;
  status: string;
  created_at: string;
  athletes?: { id: string; name: string | null; avatar_url: string | null } | null;
}

// GET /api/events/[id]/registrations — participant list + capacity summary
// for the event detail page (#8). Requires a logged-in session (any role —
// this is NOT staff-gated, per #15/#8: the participant list is meant to be
// visible to every club member, not just staff), but does require the
// caller to be an authenticated member rather than the open internet, since
// the response carries member names/avatars.
//
// Only `registered`/`waitlisted` rows are returned (a member who cancelled
// isn't a current participant). The athletes join is scoped to
// id/name/avatar_url only — never `athletes(*)` — so no email/phone/other
// PII can leak through this endpoint.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
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

    const { data, error } = await supabase
      .from('event_registrations')
      .select('athlete_id, status, created_at, athletes(id, name, avatar_url)')
      .eq('event_id', eventId)
      .in('status', ['registered', 'waitlisted'])
      .order('status', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows = (data || []) as unknown as RawRegistration[];
    const participants = rows.map((row) => ({
      athleteId: row.athlete_id,
      name: row.athletes?.name || '',
      avatarUrl: row.athletes?.avatar_url || null,
      status: row.status,
      createdAt: row.created_at,
    }));

    const registeredCount = participants.filter((p) => p.status === 'registered').length;
    const waitlistCount = participants.filter((p) => p.status === 'waitlisted').length;

    return NextResponse.json({
      participants,
      registeredCount,
      waitlistCount,
      capacity: event.capacity,
    });
  } catch (error) {
    console.error('Failed to fetch event registrations:', error);
    return NextResponse.json({ error: 'Failed to fetch event registrations' }, { status: 500 });
  }
}
