import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { notifyStaff } from '@/lib/notifications/staff';
import { availabilityChangeCopy } from '@/lib/notifications/copy';
import { setByForCaller, type Availability } from '@/lib/coach/attention';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const VALUES: Availability[] = ['active', 'injured', 'paused'];

// PUT /api/athletes/[id]/availability  { availability: 'active' | 'injured' | 'paused' }
//
// Self-or-staff (mayActFor on the verified caller): the runner marks themself, or
// a coach marks them (decision 2026-11-21). A teammate gets 403. Who set it is
// derived from the caller — a body field is ignored. A runner's own change tells
// staff through the routed kind `availability_change` (notifyStaff →
// recipientsForKind, falling back to the admins before migration 186's seed).
// 503 `migration_pending` until migration 186 adds the column.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!mayActFor(caller, id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const availability = body?.availability as Availability;
    if (!VALUES.includes(availability)) {
      return NextResponse.json({ error: 'availability must be active, injured or paused' }, { status: 400 });
    }
    const setBy = setByForCaller(caller.athleteId, id);
    const db = createServerClient();
    const { data, error } = await db
      .from('athletes')
      .update({
        availability,
        availability_set_by: availability === 'active' ? null : setBy,
        availability_since: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, name, avatar_url, availability, availability_set_by')
      .maybeSingle();
    if (error) {
      if (/availability/.test(error.message || '')) {
        return NextResponse.json({ error: 'migration_pending', details: 'migration 186 not applied' }, { status: 503 });
      }
      return NextResponse.json({ error: 'Failed to update', details: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });

    if (setBy === 'self') {
      await notifyStaff({
        kind: 'availability_change',
        url: '/dashboard',
        tag: `availability-${id}`,
        category: 'management',
        actorAthleteId: id,
        icon: data.avatar_url?.trim() || undefined,
        copy: (locale) => availabilityChangeCopy(locale, { athleteName: data.name || '', availability }),
      });
    }
    return NextResponse.json({ availability: data.availability, setBy: data.availability_set_by ?? null });
  } catch (error: any) {
    console.error('[availability] failed:', error);
    return NextResponse.json(internalErrorBody('Failed to update'), { status: 500 });
  }
}
