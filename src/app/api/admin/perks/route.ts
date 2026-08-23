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
  const { data, error } = await supabase
    .from('club_perks')
    .select('id, sponsor_name, title_he, title_en, description_he, description_en, discount_code, redeem_url, image_url, active, sort_order, created_at')
    .order('sort_order', { ascending: true });
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
  }));

  return NextResponse.json({ perks });
}

// POST /api/admin/perks — staff-only create.
// Body: { sponsorName, titleHe, titleEn, descriptionHe?, descriptionEn?, discountCode?, redeemUrl?, imageUrl? }
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const body = await request.json();
    const { sponsorName, titleHe, titleEn, descriptionHe, descriptionEn, discountCode, redeemUrl, imageUrl } = body as {
      sponsorName?: string; titleHe?: string; titleEn?: string; descriptionHe?: string; descriptionEn?: string;
      discountCode?: string; redeemUrl?: string; imageUrl?: string;
    };

    if (!sponsorName?.trim() || !titleHe?.trim() || !titleEn?.trim()) {
      return NextResponse.json({ error: 'sponsorName, titleHe and titleEn are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { count } = await supabase.from('club_perks').select('id', { count: 'exact', head: true });

    const { data, error } = await supabase
      .from('club_perks')
      .insert({
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
      })
      .select()
      .single();
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
