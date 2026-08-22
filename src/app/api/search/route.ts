import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 8;

// GET /api/search?q=<query>
// Roadmap #17 — In-App Global Search. Scoped to what's real today (members,
// events) — the checklist also lists posts/perks/store/chat, but none of
// those have enough of a real surface yet to search meaningfully (perks and
// store don't exist, and feed posts require a real Supabase JWT the way
// member/event data doesn't, which would force a different auth model for
// this one route). Extend with more categories as those surfaces mature.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ members: [], events: [] });
    }

    const supabase = createServerClient();
    const pattern = `%${q}%`;

    const [membersRes, eventsRes] = await Promise.all([
      supabase
        .from('athletes')
        .select('id, name, avatar_url')
        .eq('status', 'active')
        .ilike('name', pattern)
        .limit(RESULT_LIMIT),
      supabase
        .from('events')
        .select('id, name, kind, date, location')
        .or(`name.ilike.${pattern},location.ilike.${pattern}`)
        .order('date', { ascending: false })
        .limit(RESULT_LIMIT),
    ]);

    const members = (membersRes.error ? [] : membersRes.data || []).map(
      (a: { id: string; name: string; avatar_url: string | null }) => ({
        id: a.id,
        name: a.name,
        avatarUrl: a.avatar_url || null,
      }),
    );

    // events (migration 055) may not be applied in every environment —
    // degrade to no event results rather than failing the whole search.
    const events = (eventsRes.error ? [] : eventsRes.data || []).map(
      (e: { id: string; name: string; kind: string; date: string; location: string }) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        date: e.date,
        location: e.location,
      }),
    );

    return NextResponse.json({ members, events });
  } catch (error) {
    console.error('Search failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
