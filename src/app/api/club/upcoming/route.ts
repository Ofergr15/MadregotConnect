import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireMember } from '@/lib/auth/self-or-staff';
import { rethrowIfDynamicBailout } from '@/lib/dynamic-bailout';
import { buildUpcoming } from '@/lib/events/upcoming';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/club/upcoming
// The three "what's next" lanes behind the feed's upcoming-events card: races,
// club events, birthdays. See lib/events/upcoming.ts for the date rules.
//
// ── Why this is its own route and not two fetches from the card ──────────────
// The events half could come from /api/events, which is already public — but the
// birthdays half cannot go anywhere near it. So one member-gated route serves
// both lanes, and the card makes one request instead of two.
//
// ── What it exposes ─────────────────────────────────────────────────────────
// `requireMember`, the same gate as /api/groups/standings and
// /api/athletes/[id]/stats. Nothing here is new to a signed-in member: the
// events are already on the calendar, and the names are already the club roster
// that /api/groups hands every member.
//
// The one genuinely personal field is the birth date, and it never leaves this
// route. `buildUpcoming` converts it to the NEXT occurrence and drops the year,
// so the response can say "Roy, in 4 days" without telling the club how old
// anybody is. Athletes with no stored birth date (7 of 24 today) simply don't
// appear — the lane is best-effort by design, and asking people for a birth date
// to fill it in is not something this card should force.
export async function GET(request: Request) {
  try {
    const denied = await requireMember(request);
    if (denied) return denied;

    // A day-granularity card: a few minutes of staleness is invisible, and this
    // renders on the feed, which is the most-loaded screen in the app.
    const supabase = createServerClient({ revalidateSeconds: 300 });
    const today = israelToday(); // Israel's calendar day, not the server's UTC one

    const [eventsRes, athletesRes] = await Promise.all([
      supabase
        .from('events')
        .select('id, kind, name, date, end_date, start_time, location, distances')
        // The lower bound is deliberately looser than "date >= today": a camp
        // that started yesterday and runs through Sunday is still upcoming, and
        // filtering on the start date alone would drop it. `buildUpcoming` trims
        // by end_date; 30 days is more than the widest span the calendar draws.
        .gte('date', shiftDays(today, -30))
        .order('date', { ascending: true }),
      supabase
        .from('athletes')
        .select('id, name, birth_date, status')
        .eq('coach_id', COACH_ID)
        .eq('status', 'active'),
    ]);

    if (eventsRes.error) throw eventsRes.error;
    // A failed roster read costs the birthdays lane, not the whole card — the
    // races and club events are the part somebody opened this for.
    const athletes = athletesRes.error ? [] : athletesRes.data || [];

    const buckets = buildUpcoming({ events: eventsRes.data || [], athletes, today });
    return NextResponse.json({ ...buckets, today });
  } catch (error: unknown) {
    rethrowIfDynamicBailout(error);
    console.error('Upcoming events error:', error);
    return NextResponse.json({ error: 'Failed to load upcoming events' }, { status: 500 });
  }
}

/** Local-date arithmetic on an ISO day, at noon so DST can't shift it. */
function shiftDays(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
