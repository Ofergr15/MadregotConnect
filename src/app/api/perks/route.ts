import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// GET /api/perks — the club's perk list (active only), filtered by tier.
// Roadmap #5, Benefits / Discounts. Some sponsor deals have a richer
// 'core_runner' tier on top of the 'all' base offer everyone gets (see
// migration 070).
//
// This used to be an open read that took `?athleteId=…` and looked that
// athlete's role up in the DB to decide the tier. Two problems, one of them
// real money: the response carries `discount_code` and `redeem_url`, so the
// whole sponsor deal set was public to anyone who found the URL — and naming
// ANY core_runner athlete's id (they show up by name on the leaderboard) also
// handed over the premium tier. Both halves now come from the session: club
// membership to see perks at all, and the caller's OWN role for the tier.
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    // Staff review the full catalogue (there's an admin screen behind it), and
    // the super user sees everything by convention.
    const isCoreRunner =
      caller.role === 'core_runner' || caller.isStaff || caller.isSuperUser;

    const supabase = createServerClient();

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
