import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { EVENT_KINDS, isEventKind } from '@/lib/events';

export const dynamic = 'force-dynamic';

// GET /api/events?kind=race&from=YYYY-MM-DD&to=YYYY-MM-DD
//   -> list events, date ascending. No auth required — same public-read
//      convention as the legacy /api/races route this genericizes.
//   `from` overrides the default "upcoming only" lower bound (so past events
//   can be browsed too, e.g. for a history view); `to` is an additional upper
//   bound applied either way. Omit both for "everything from today on".
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const supabase = createServerClient();
    let query = supabase.from('events').select('*');

    if (kind) query = query.eq('kind', kind);
    query = query.gte('date', from || new Date().toISOString().split('T')[0]);
    if (to) query = query.lte('date', to);

    const { data, error } = await query.order('date', { ascending: true });
    if (error) throw error;

    return NextResponse.json({ events: data || [] });
  } catch (error) {
    console.error('Failed to fetch events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

// POST /api/events — staff-only (admin/coach/academy_coach) create.
// Body: { kind, name, date, location, ...optional fields }.
//
// Note: /api/races' POST (the single-purpose table this genericizes) has no
// auth gate at all — a pre-existing gap there. That insecure pattern is
// deliberately NOT copied forward here; this route is properly staff-gated.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      kind,
      name,
      date,
      location,
      description,
      end_date,
      start_time,
      lat,
      lng,
      waze_url,
      distances,
      race_class,
      website,
      agenda,
      gear,
      faqs,
      capacity,
      registration_deadline,
    } = body || {};

    if (!kind || !name || !date || !location) {
      return NextResponse.json(
        { error: 'kind, name, date, and location are required' },
        { status: 400 },
      );
    }
    if (!isEventKind(kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${EVENT_KINDS.join(', ')}` },
        { status: 400 },
      );
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('events')
      .insert({
        kind,
        name,
        date,
        location,
        description: description || null,
        end_date: end_date || null,
        start_time: start_time || null,
        lat: lat ?? null,
        lng: lng ?? null,
        waze_url: waze_url || null,
        distances: distances || [],
        race_class: race_class || null,
        website: website || null,
        agenda: agenda || null,
        gear: gear || null,
        faqs: faqs || null,
        capacity: capacity ?? null,
        registration_deadline: registration_deadline || null,
        created_by: auth.user.athleteId,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ event: data });
  } catch (error) {
    console.error('Failed to create event:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
