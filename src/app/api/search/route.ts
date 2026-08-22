import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 8;

// GET /api/search?q=<query>
// Roadmap #17 — In-App Global Search. Members, events, plus the actual
// content inside Store and Benefits (product/perk names) — not just the
// section names, which the client-side "sections" category already covers.
// Feed posts still aren't included: they require a real Supabase JWT the way
// member/event/store/perk data doesn't, which would force a different auth
// model for this one route. Extend with more categories as those surfaces
// mature.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ members: [], events: [], products: [], perks: [] });
    }

    const supabase = createServerClient();
    const pattern = `%${q}%`;

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
        .or(`name.ilike.${pattern},location.ilike.${pattern}`)
        .order('date', { ascending: false })
        .limit(RESULT_LIMIT),
      supabase
        .from('store_products')
        .select('id, name_he, name_en, price, image_url')
        .eq('active', true)
        .or(`name_he.ilike.${pattern},name_en.ilike.${pattern}`)
        .limit(RESULT_LIMIT),
      supabase
        .from('club_perks')
        .select('id, sponsor_name, title_he, title_en, image_url')
        .eq('active', true)
        .or(`title_he.ilike.${pattern},title_en.ilike.${pattern},sponsor_name.ilike.${pattern}`)
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
