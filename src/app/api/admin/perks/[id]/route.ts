import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/perks/[id] — staff-only partial update (e.g. toggling
// `active`, editing the code/link). Every field optional; only provided keys
// are written.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const body = await request.json();
    const { sponsorName, titleHe, titleEn, descriptionHe, descriptionEn, discountCode, redeemUrl, imageUrl, active, tier } = body as {
      sponsorName?: string; titleHe?: string; titleEn?: string; descriptionHe?: string; descriptionEn?: string;
      discountCode?: string; redeemUrl?: string; imageUrl?: string; active?: boolean; tier?: 'all' | 'core_runner';
    };

    if (tier !== undefined && tier !== 'all' && tier !== 'core_runner') {
      return NextResponse.json({ error: "tier must be 'all' or 'core_runner'" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (sponsorName !== undefined) updates.sponsor_name = sponsorName.trim();
    if (titleHe !== undefined) updates.title_he = titleHe.trim();
    if (titleEn !== undefined) updates.title_en = titleEn.trim();
    if (descriptionHe !== undefined) updates.description_he = descriptionHe?.trim() || null;
    if (descriptionEn !== undefined) updates.description_en = descriptionEn?.trim() || null;
    if (discountCode !== undefined) updates.discount_code = discountCode?.trim() || null;
    if (redeemUrl !== undefined) updates.redeem_url = redeemUrl?.trim() || null;
    if (imageUrl !== undefined) updates.image_url = imageUrl || null;
    if (active !== undefined) updates.active = !!active;
    if (tier !== undefined) updates.tier = tier;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = createServerClient();
    let { data, error } = await supabase.from('club_perks').update(updates).eq('id', id).select().single();
    if ((error?.code === '42703' || error?.code === 'PGRST204') && 'tier' in updates) {
      // tier column not migrated yet — drop it and retry the rest of the update.
      const { tier: _tier, ...coreUpdates } = updates;
      if (Object.keys(coreUpdates).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }
      ({ data, error } = await supabase.from('club_perks').update(coreUpdates).eq('id', id).select().single());
    }
    if (error) throw error;

    return NextResponse.json({ perk: data });
  } catch (error) {
    console.error('Failed to update perk:', error);
    return NextResponse.json({ error: 'Failed to update perk' }, { status: 500 });
  }
}

// DELETE /api/admin/perks/[id] — staff-only remove.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const supabase = createServerClient();
    const { error } = await supabase.from('club_perks').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete perk:', error);
    return NextResponse.json({ error: 'Failed to delete perk' }, { status: 500 });
  }
}
