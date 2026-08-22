import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

const METRICS = ['distance_km', 'workout_count', 'elevation_m'] as const;
type Metric = (typeof METRICS)[number];
const SCOPES = ['individual', 'group'] as const;
type Scope = (typeof SCOPES)[number];

// PATCH /api/admin/challenges/[id] — staff-only partial update. Every field
// optional; only provided keys are written. name/description also propagate
// to the underlying badge row (kept in sync — see migration 062's comment:
// the badge is 1:1 and never shared).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const body = await request.json();
    const { nameHe, nameEn, descriptionHe, descriptionEn, metric, targetValue, scope, startDate, endDate, iconUrl, active } = body as {
      nameHe?: string; nameEn?: string; descriptionHe?: string; descriptionEn?: string;
      metric?: string; targetValue?: number; scope?: string; startDate?: string; endDate?: string;
      iconUrl?: string; active?: boolean;
    };

    const updates: Record<string, unknown> = {};
    const badgeUpdates: Record<string, unknown> = {};
    if (nameHe !== undefined) { updates.name_he = nameHe.trim(); badgeUpdates.name_he = nameHe.trim(); }
    if (nameEn !== undefined) { updates.name_en = nameEn.trim(); badgeUpdates.name_en = nameEn.trim(); }
    if (descriptionHe !== undefined) { updates.description_he = descriptionHe?.trim() || null; badgeUpdates.description_he = descriptionHe?.trim() || null; }
    if (descriptionEn !== undefined) { updates.description_en = descriptionEn?.trim() || null; badgeUpdates.description_en = descriptionEn?.trim() || null; }
    if (iconUrl !== undefined) badgeUpdates.icon_url = iconUrl || null;
    if (active !== undefined) updates.active = !!active;
    if (metric !== undefined) {
      if (!METRICS.includes(metric as Metric)) {
        return NextResponse.json({ error: `metric must be one of ${METRICS.join(', ')}` }, { status: 400 });
      }
      updates.metric = metric;
    }
    if (targetValue !== undefined) {
      const target = Number(targetValue);
      if (!Number.isFinite(target) || target <= 0) {
        return NextResponse.json({ error: 'targetValue must be a positive number' }, { status: 400 });
      }
      updates.target_value = target;
    }
    if (scope !== undefined) {
      if (!SCOPES.includes(scope as Scope)) {
        return NextResponse.json({ error: `scope must be one of ${SCOPES.join(', ')}` }, { status: 400 });
      }
      updates.scope = scope;
    }
    if (startDate !== undefined) updates.start_date = startDate;
    if (endDate !== undefined) updates.end_date = endDate;
    if (updates.start_date && updates.end_date && (updates.end_date as string) < (updates.start_date as string)) {
      return NextResponse.json({ error: 'endDate must not be before startDate' }, { status: 400 });
    }

    if (Object.keys(updates).length === 0 && Object.keys(badgeUpdates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: challenge, error } = await supabase.from('challenges').update(updates).eq('id', id).select().single();
    if (error) throw error;

    if (Object.keys(badgeUpdates).length > 0) {
      const { error: badgeError } = await supabase.from('badges').update(badgeUpdates).eq('id', challenge.badge_id);
      if (badgeError) throw badgeError;
    }

    return NextResponse.json({ challenge });
  } catch (error) {
    console.error('Failed to update challenge:', error);
    return NextResponse.json({ error: 'Failed to update challenge' }, { status: 500 });
  }
}

// DELETE /api/admin/challenges/[id] — staff-only remove. Blocked if any
// athlete already earned the challenge's completion badge (same
// ON DELETE CASCADE concern as badges) — deactivate instead in that case.
// Deletes the challenge row, then its paired badge (never shared — see
// migration 062).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data: challenge, error: fetchError } = await supabase
      .from('challenges')
      .select('id, badge_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!challenge) return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });

    const { count, error: countError } = await supabase
      .from('athlete_badges')
      .select('id', { count: 'exact', head: true })
      .eq('badge_id', challenge.badge_id);
    if (countError) throw countError;
    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: `${count} athlete(s) already completed this challenge — deactivate it instead of deleting.` },
        { status: 409 },
      );
    }

    const { error } = await supabase.from('challenges').delete().eq('id', id);
    if (error) throw error;
    // Best-effort — the challenge row is already gone either way.
    await supabase.from('badges').delete().eq('id', challenge.badge_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete challenge:', error);
    return NextResponse.json({ error: 'Failed to delete challenge' }, { status: 500 });
  }
}
