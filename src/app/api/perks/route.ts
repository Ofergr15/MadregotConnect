import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/perks — the public perk list (active only).
// Roadmap #5, Benefits / Discounts. No auth required — same "public read"
// convention as GET /api/store/products: sponsor perks are never
// athlete-specific.
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('club_perks')
      .select('id, sponsor_name, title_he, title_en, description_he, description_en, discount_code, redeem_url, image_url')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ perks: [] });
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
    }));

    return NextResponse.json({ perks });
  } catch (error) {
    console.error('Failed to fetch perks:', error);
    return NextResponse.json({ error: 'Failed to fetch perks' }, { status: 500 });
  }
}
