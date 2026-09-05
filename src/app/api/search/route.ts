import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { containsPattern, quoteFilterValue } from '@/lib/db/like';

export const dynamic = 'force-dynamic';

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 8;

// GET /api/search?q=<query>
// Roadmap #17 — In-App Global Search. Members, events, plus the actual
// content inside Store and Benefits (product/perk names) — not just the
// section names, which the client-side "sections" category already covers.
//
// The old note here said feed posts were excluded because they "require a real
// Supabase JWT the way member/event/store/perk data doesn't". That was the bug,
// not the design: the members category is a name-prefix lookup over the whole
// active roster, which made this the easiest way to enumerate the club without
// an account. It's session-gated now, so adding feed posts is no longer a
// different auth model — just more categories.
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ members: [], events: [], products: [], perks: [] });
    }

    const supabase = createServerClient();
    // `pattern` for the single-column helpers, `filterPattern` for the `.or()`
    // strings — see src/lib/db/like.ts for why they differ. Typing a comma used
    // to 400 the whole request; typing `_` used to match any character.
    const pattern = containsPattern(q);
    const filterPattern = quoteFilterValue(pattern);

    // Mirrors GET /api/perks's tier gate exactly — a core_runner-tier perk must
    // stay invisible to everyone else, including via search. Same fix, too: the
    // tier is the CALLER's own, not that of whatever id they sent.
    const isCoreRunner =
      caller.role === 'core_runner' || caller.isStaff || caller.isSuperUser;

    let perksQuery = supabase
      .from('club_perks')
      .select('id, sponsor_name, title_he, title_en, image_url')
      .eq('active', true)
      .or(`title_he.ilike.${filterPattern},title_en.ilike.${filterPattern},sponsor_name.ilike.${filterPattern}`)
      .limit(RESULT_LIMIT);
    if (!isCoreRunner) perksQuery = perksQuery.eq('tier', 'all');

    const [membersRes, eventsRes, productsRes, perksRes] = await Promise.all([
      supabase
        .from('athletes')
        .select('id, name, avatar_url')
        .eq('status', 'active')
        .ilike('name', pattern)
        .limit(RESULT_LIMIT),
      supabase
        .from('events')
        .select('id, name, kind, date, location')
        .or(`name.ilike.${filterPattern},location.ilike.${filterPattern}`)
        .order('date', { ascending: false })
        .limit(RESULT_LIMIT),
      supabase
        .from('store_products')
        .select('id, name_he, name_en, price, image_url')
        .eq('active', true)
        .or(`name_he.ilike.${filterPattern},name_en.ilike.${filterPattern}`)
        .limit(RESULT_LIMIT),
      perksQuery,
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

    // store_products/club_perks (migrations 064/066) may not be applied in
    // every environment — degrade to no results rather than failing search.
    const products = (productsRes.error ? [] : productsRes.data || []).map(
      (p: { id: string; name_he: string; name_en: string; price: number; image_url: string | null }) => ({
        id: p.id,
        nameHe: p.name_he,
        nameEn: p.name_en,
        price: p.price,
        imageUrl: p.image_url,
      }),
    );

    const perks = (perksRes.error ? [] : perksRes.data || []).map(
      (p: { id: string; sponsor_name: string; title_he: string; title_en: string; image_url: string | null }) => ({
        id: p.id,
        sponsorName: p.sponsor_name,
        titleHe: p.title_he,
        titleEn: p.title_en,
        imageUrl: p.image_url,
      }),
    );

    return NextResponse.json({ members, events, products, perks });
  } catch (error) {
    console.error('Search failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
