import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/perks?athleteId=… — the public perk list (active only), filtered
// by tier. Roadmap #5, Benefits / Discounts. Some sponsor deals have a
// richer 'core_runner' tier on top of the 'all' base offer everyone gets
// (see migration 070) — athleteId is optional (no auth required, same
// "public read" convention as GET /api/store/products) but when given,
// core-runner-tier perks only show for athletes with that role. No athleteId
// → 'all' tier only, the safe default.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const supabase = createServerClient();

    let isCoreRunner = false;
    if (athleteId) {
      const { data: athlete } = await supabase.from('athletes').select('role').eq('id', athleteId).maybeSingle();
      isCoreRunner = (athlete as { role?: string } | null)?.role === 'core_runner';
    }

    let query = supabase
      .from('club_perks')
      .select('id, sponsor_name, title_he, title_en, description_he, description_en, discount_code, redeem_url, image_url, tier')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (!isCoreRunner) query = query.eq('tier', 'all');
    const { data, error } = await query;
    if (error) {
      if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ perks: [] });
      // tier column not migrated yet — degrade to the pre-070 shape (no
      // tier filtering) instead of 500ing the whole route.
      if (error.code === '42703' || error.code === 'PGRST204') {
        const fallback = await supabase
          .from('club_perks')
          .select('id, sponsor_name, title_he, title_en, description_he, description_en, discount_code, redeem_url, image_url')
          .eq('active', true)
          .order('sort_order', { ascending: true });
        if (fallback.error) throw fallback.error;
        return NextResponse.json({
          perks: (fallback.data || []).map((p: Record<string, unknown>) => ({
            id: p.id, sponsorName: p.sponsor_name, titleHe: p.title_he, titleEn: p.title_en,
            descriptionHe: p.description_he, descriptionEn: p.description_en,
            discountCode: p.discount_code, redeemUrl: p.redeem_url, imageUrl: p.image_url,
          })),
        });
      }
      throw error;
    }

    const perks = (data || []).map((p: Record<string, unknown>) => ({
      id: p.id,
      sponsorName: p.sponsor_name,
      titleHe: p.title_he,
      titleEn: p.title_en,
      descriptionHe: p.description_he,
      descriptionEn: p.description_en,
      discountCode: p.discount_code,
      redeemUrl: p.redeem_url,
      imageUrl: p.image_url,
      tier: p.tier,
    }));

    return NextResponse.json({ perks });
  } catch (error) {
    console.error('Failed to fetch perks:', error);
    return NextResponse.json({ error: 'Failed to fetch perks' }, { status: 500 });
  }
}
