import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { normalizeOwners, OWNERS_KEY } from '@/lib/week-setup/model';
import { writeSetting } from '@/lib/week-setup/server';

export const dynamic = 'force-dynamic';

// PUT /api/week-setup/owners { owners: { workouts: 'coach'|'admin'|'both', … } } — admin only.
export async function PUT(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const roles = caller.roles ?? [caller.role];
  if (!caller.isSuperUser && !roles.includes('admin')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const body = await request.json().catch(() => null);
  try {
    const owners = normalizeOwners(body?.owners);
    await writeSetting(createServerClient(), OWNERS_KEY, owners);
    return NextResponse.json({ owners });
  } catch (error) {
    console.error('[week-setup] owners failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
