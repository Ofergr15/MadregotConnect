import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { resolveAudience, sendPushToSubscriptions } from '@/lib/push';

export const dynamic = 'force-dynamic';

// GET /api/admin/perks — staff-only, full list incl. inactive (the public
// GET /api/perks only shows active ones).
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  const supabase = createServerClient();
  let { data, error } = await supabase
    .from('club_perks')
    .select('id, sponsor_name, title_he, title_en, description_he, description_en, discount_code, redeem_url, image_url, active, sort_order, created_at, tier')
    .order('sort_order', { ascending: true })
    .returns<Record<string, unknown>[]>();
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    // tier column not migrated yet — degrade instead of failing the list.
    ({ data, error } = await supabase
      .from('club_perks')
      .select('id, sponsor_name, title_he, title_en, description_he, description_en, discount_code, redeem_url, image_url, active, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .returns<Record<string, unknown>[]>());
  }
  if (error) {
    if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ perks: [] });
    return NextResponse.json({ error: 'Failed to fetch perks' }, { status: 500 });
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
    active: p.active,
    sortOrder: p.sort_order,
    tier: (p.tier as string | undefined) || 'all',
  }));

  return NextResponse.json({ perks });
}

// POST /api/admin/perks — staff-only create.
// Body: { sponsorName, titleHe, titleEn, descriptionHe?, descriptionEn?, discountCode?, redeemUrl?, imageUrl?, tier? }
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const body = await request.json();
    const { sponsorName, titleHe, titleEn, descriptionHe, descriptionEn, discountCode, redeemUrl, imageUrl, tier } = body as {
      sponsorName?: string; titleHe?: string; titleEn?: string; descriptionHe?: string; descriptionEn?: string;
      discountCode?: string; redeemUrl?: string; imageUrl?: string; tier?: 'all' | 'core_runner';
    };

    if (!sponsorName?.trim() || !titleHe?.trim() || !titleEn?.trim()) {
      return NextResponse.json({ error: 'sponsorName, titleHe and titleEn are required' }, { status: 400 });
    }
    if (tier !== undefined && tier !== 'all' && tier !== 'core_runner') {
      return NextResponse.json({ error: "tier must be 'all' or 'core_runner'" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { count } = await supabase.from('club_perks').select('id', { count: 'exact', head: true });

    const row = {
      sponsor_name: sponsorName.trim(),
      title_he: titleHe.trim(),
      title_en: titleEn.trim(),
      description_he: descriptionHe?.trim() || null,
      description_en: descriptionEn?.trim() || null,
      discount_code: discountCode?.trim() || null,
      redeem_url: redeemUrl?.trim() || null,
      image_url: imageUrl || null,
      sort_order: count || 0,
      created_by: auth.user.athleteId,
      tier: tier || 'all',
    };
    let { data, error } = await supabase.from('club_perks').insert(row).select().single();
    if (error?.code === '42703' || error?.code === 'PGRST204') {
      // tier column not migrated yet — drop it and retry rather than losing
      // the whole create over one not-yet-applied column.
      const { tier: _tier, ...coreRow } = row;
      ({ data, error } = await supabase.from('club_perks').insert(coreRow).select().single());
    }
    if (error) throw error;

    // Previously athletes only learned of a new perk by opening Benefits
    // themselves — nothing ever surfaced it. Mutable (news), same as the
    // Notification Center's own broadcasts.
    try {
      const subs = await resolveAudience('all', null);
      if (subs.length > 0) {
        await sendPushToSubscriptions(subs, {
          title: '🎁 הטבה חדשה!',
          body: `${sponsorName.trim()}: ${titleHe.trim()}`,
          url: '/dashboard/benefits',
          tag: `perk-${data.id}`,
          category: 'news',
        });
      }
    } catch {
      // best-effort — never let a push failure affect perk creation
    }

    return NextResponse.json({ perk: data });
  } catch (error) {
    console.error('Failed to create perk:', error);
    return NextResponse.json({ error: 'Failed to create perk' }, { status: 500 });
  }
}
