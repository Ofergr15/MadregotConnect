import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

type AdminRuleType = 'cumulative_distance' | 'cumulative_duration';

// PATCH /api/admin/badges/[id] — staff-only partial update. Every field
// optional; only provided keys are written. Scoped to the same two
// admin-creatable rule_types as POST (see that route's comment) — editing a
// seed-only badge's rule_type isn't offered by the UI, but metricType/
// thresholdValue are still accepted if a caller wants to convert one.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const body = await request.json();
    const { nameHe, nameEn, descriptionHe, descriptionEn, metricType, thresholdValue, iconUrl, active } = body as {
      nameHe?: string; nameEn?: string; descriptionHe?: string; descriptionEn?: string;
      metricType?: string; thresholdValue?: number; iconUrl?: string; active?: boolean;
    };

    const updates: Record<string, unknown> = {};
    if (nameHe !== undefined) updates.name_he = nameHe.trim();
    if (nameEn !== undefined) updates.name_en = nameEn.trim();
    if (descriptionHe !== undefined) updates.description_he = descriptionHe?.trim() || null;
    if (descriptionEn !== undefined) updates.description_en = descriptionEn?.trim() || null;
    if (iconUrl !== undefined) updates.icon_url = iconUrl || null;
    if (active !== undefined) updates.active = !!active;

    if (metricType !== undefined || thresholdValue !== undefined) {
      if (metricType !== 'distance' && metricType !== 'duration') {
        return NextResponse.json({ error: "metricType must be 'distance' or 'duration'" }, { status: 400 });
      }
      const threshold = Number(thresholdValue);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        return NextResponse.json({ error: 'thresholdValue must be a positive number' }, { status: 400 });
      }
      const ruleType: AdminRuleType = metricType === 'distance' ? 'cumulative_distance' : 'cumulative_duration';
      updates.rule_type = ruleType;
      updates.rule_params = metricType === 'distance' ? { km: threshold } : { hours: threshold };
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase.from('badges').update(updates).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ badge: data });
  } catch (error) {
    console.error('Failed to update badge:', error);
    return NextResponse.json({ error: 'Failed to update badge' }, { status: 500 });
  }
}

// DELETE /api/admin/badges/[id] — staff-only remove. Blocked if any athlete
// has already earned this badge (athlete_badges.badge_id ON DELETE CASCADE
// would silently erase their achievement history) — deactivate instead in
// that case.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { count, error: countError } = await supabase
      .from('athlete_badges')
      .select('id', { count: 'exact', head: true })
      .eq('badge_id', id);
    if (countError) throw countError;
    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: `${count} athlete(s) already earned this badge — deactivate it instead of deleting.` },
        { status: 409 },
      );
    }

    const { error } = await supabase.from('badges').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete badge:', error);
    return NextResponse.json({ error: 'Failed to delete badge' }, { status: 500 });
  }
}
