import { invalidateShared, sharedCache, SHARED_TAGS } from '@/lib/cache/shared';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { EVENT_KINDS, isCourseGpxUrl, isEventKind } from '@/lib/events';
import { resolveAudience, sendPushLocalized } from '@/lib/push';
import { newEventCopy } from '@/lib/notifications/copy';
import { israelToday } from '@/lib/utils';
import { isMissingSchema, normaliseBlocks, projectEvents } from '@/lib/events/lifecycle';
import { callerIsStaff, optionalCaller, replaceBlocks } from '@/lib/events/server';

export const dynamic = 'force-dynamic';

// GET /api/events?kind=race&from=YYYY-MM-DD&to=YYYY-MM-DD
//   -> list events, date ascending. No auth required — same public-read
//      convention as the legacy /api/races route this genericizes.
//   `from` overrides the default "upcoming only" lower bound (so past events
//   can be browsed too, e.g. for a history view); `to` is an additional upper
//   bound applied either way. Omit both for "everything from today on".
// The calendar's raw rows — the same for every member (lib/cache/shared.ts). Drafts
// and pending versions ARE in here; `projectEvents` below strips them per caller on
// every request, exactly as before. No registrations/RSVPs: those live in their own
// table and never enter this cache. Throws on error so an error is never cached.
const readEventRows = sharedCache(async (kind: string | null, lower: string, to: string | null) => {
  let query = createServerClient().from('events').select('*');
  if (kind) query = query.eq('kind', kind);
  query = query.or(`end_date.gte.${lower},and(end_date.is.null,date.gte.${lower})`);
  if (to) query = query.lte('date', to);
  const { data, error } = await query.order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}, ['events:rows:v1'], { tag: SHARED_TAGS.events, revalidate: 120 });

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

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
    const data = await readEventRows(kind, lower, to);

    // Events v2: drafts and not-yet-live scheduled events only for verified staff;
    // `pending` never leaves for anyone else. Rows without `status` (pre-184) pass.
    const caller = await optionalCaller(request);
    return NextResponse.json({ events: projectEvents(data || [], callerIsStaff(caller), new Date()) });
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
  if (!auth.user.isStaff && !auth.user.isSuperUser) {
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
      course_gpx_url,
      cover_image_url,
      logo_url,
      notify,
    } = body || {};
    // `notify: false` creates the event silently: no push to anyone (manager drafts,
    // synthetic test events). Absent = the original behaviour, so old clients are unchanged.
    // Ported from ec9d28b2 (the native ManagerModel sends it).
    if (notify !== undefined && typeof notify !== 'boolean') {
      return NextResponse.json({ error: 'notify must be a boolean' }, { status: 400 });
    }
    // v2: a new event may start as a draft (native editor). The PWA form sends no
    // status, so it keeps creating published events that push immediately.
    const status = body?.status === 'draft' ? 'draft' : 'published';
    const blocks = normaliseBlocks(body?.blocks);

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

    if (course_gpx_url !== undefined && !isCourseGpxUrl(course_gpx_url)) {
      return NextResponse.json({ error: 'course_gpx_url must be an https URL or null' }, { status: 400 });
    }

    const supabase = createServerClient();
    const v2 = {
      ...(cover_image_url ? { cover_image_url } : {}),
      ...(logo_url ? { logo_url } : {}),
      ...(status === 'draft' ? { status } : {}),
    };
    const base = {
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
        // Only when sent: before migration 200 an absent key keeps event creation working.
        ...(course_gpx_url !== undefined ? { course_gpx_url } : {}),
    };
    let { data, error } = await supabase.from('events').insert({ ...base, ...v2 }).select().single();
    if (error && Object.keys(v2).length > 0 && isMissingSchema(error)) {
      // Migration 184 not applied: a draft can't be represented, so refuse rather
      // than silently publishing what the coach meant to keep private.
      if (status === 'draft') {
        return NextResponse.json({ error: 'Drafts need migration 184' }, { status: 409 });
      }
      ({ data, error } = await supabase.from('events').insert(base).select().single());
    }
    invalidateShared(SHARED_TAGS.events);
    if (error) throw error;
    if (blocks && blocks.length > 0) {
      try { await replaceBlocks(supabase, data.id, blocks); } catch (e) { console.error('event blocks insert failed', e); }
    }
    if (status === 'draft') return NextResponse.json({ event: data, notified: false });

    // Previously athletes only learned of a new event by opening the
    // calendar themselves — nothing ever surfaced it, unlike a new perk
    // (which already pushes) or a new post. Registration opens the moment
    // the event exists (this schema has no separate "opens later" concept —
    // see registration_deadline for the only other date involved), so one
    // push covers both "there's a new event" and "you can register now."
    if (notify !== false) try {
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

    return NextResponse.json({ event: data, notified: notify !== false });
  } catch (error) {
    console.error('Failed to create event:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
