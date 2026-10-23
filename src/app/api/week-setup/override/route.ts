import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { canEdit, withOverride, OVERRIDES_KEY, type NotifOverride } from '@/lib/week-setup/model';
import { loadOverrides, loadOwners, writeSetting } from '@/lib/week-setup/server';

export const dynamic = 'force-dynamic';

const SUNDAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^(dayBefore|eveningBefore):[0-6]$|^weekStory$/;

// PUT /api/week-setup/override { week, key, value }  — this week's change to one automatic
// notification (off / text / hour); `value: null` goes back to the default. The tick reads it.
export async function PUT(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const week = typeof body?.week === 'string' ? body.week : '';
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!SUNDAY.test(week) || !KEY.test(key)) return NextResponse.json({ error: 'week (a Sunday) and a notification key are required' }, { status: 400 });
  const supabase = createServerClient();
  const roles = caller.roles ?? [caller.role];
  const owners = await loadOwners(supabase);
  if (!canEdit('notifications', owners, { admin: caller.isSuperUser || roles.includes('admin'), coach: caller.isStaff })) {
    return NextResponse.json({ error: 'Not yours to change' }, { status: 403 });
  }
  const v = body?.value;
  const value: NotifOverride | null = v && typeof v === 'object'
    ? { off: !!v.off, title: typeof v.title === 'string' ? v.title : undefined, body: typeof v.body === 'string' ? v.body : undefined, hour: Number.isInteger(v.hour) ? v.hour : undefined, audience: typeof v.audience === 'string' ? v.audience : undefined }
    : null;
  try {
    const store = await loadOverrides(supabase);
    await writeSetting(supabase, OVERRIDES_KEY, withOverride(store, week, key, value, israelToday()));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[week-setup] override failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
