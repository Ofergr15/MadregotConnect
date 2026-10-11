import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { EVENT_KINDS, isEventKind } from '@/lib/events';
import { resolveAudience, sendPushLocalized } from '@/lib/push';
import { newEventCopy } from '@/lib/notifications/copy';
import { israelToday } from '@/lib/utils';

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
    // "Upcoming from today" in Israel — a UTC date would still hide today's
    // event during the 00:00-03:00 window, or show yesterday's after 21:00.
    //
    // By OVERLAP, not by start date: an event is in the range if it is still on
    // when the range begins. Filtering `date >= from` dropped a camp from Jan 30 to
    // Feb 2 out of February's grid entirely (the page draws every day an event
    // covers, but was never given it), and an event already under way out of
    // "upcoming". Ends on its own date when it has no end_date.
    // `from` reaches a PostgREST filter string below, so it must be a plain date.
    const isDate = (v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDate(from) || !isDate(to)) {
      return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
    }
    const lower = from || israelToday();
    query = query.or(`end_date.gte.${lower},and(end_date.is.null,date.gte.${lower})`);
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

    // Previously athletes only learned of a new event by opening the
    // calendar themselves — nothing ever surfaced it, unlike a new perk
    // (which already pushes) or a new post. Registration opens the moment
    // the event exists (this schema has no separate "opens later" concept —
    // see registration_deadline for the only other date involved), so one
    // push covers both "there's a new event" and "you can register now."
    try {
      const subs = await resolveAudience('all', null);
      if (subs.length > 0) {
        await sendPushLocalized(subs, (locale) => ({
          ...newEventCopy(locale, { kind, name, date }),
          url: `/dashboard/calendar/${data.id}`,
          tag: `event-${data.id}`,
          category: 'events',
        }));
      }
    } catch {
      // best-effort — never let a push failure affect event creation
    }

    return NextResponse.json({ event: data });
  } catch (error) {
    console.error('Failed to create event:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
