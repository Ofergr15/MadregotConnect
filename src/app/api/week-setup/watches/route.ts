import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { canEdit } from '@/lib/week-setup/model';
import { loadOwners } from '@/lib/week-setup/server';
import { watchBatches } from '@/lib/week-setup/watch-batches';

export const dynamic = 'force-dynamic';

const SUNDAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/week-setup/watches?week=YYYY-MM-DD[&only=id,id] → { planId, batches, runners } — the
// week's send to the watches, prepared (lib/week-setup/watch-batches). The screen posts it to
// /api/garmin/push-workouts as the planner does. The workouts' owner (or an admin).
export async function GET(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const week = url.searchParams.get('week') || '';
  if (!SUNDAY.test(week)) return NextResponse.json({ error: 'week is required' }, { status: 400 });
  const only = (url.searchParams.get('only') || '').split(',').filter((x) => UUID.test(x));
  const supabase = createServerClient();
  const roles = caller.roles ?? [caller.role];
  if (!canEdit('workouts', await loadOwners(supabase), { admin: caller.isSuperUser || roles.includes('admin'), coach: caller.isStaff })) {
    return NextResponse.json({ error: 'Not yours to send' }, { status: 403 });
  }
  const prepared = await watchBatches(supabase, week, only.length ? only : null);
  if (!prepared) return NextResponse.json({ error: 'no plan for the week' }, { status: 404 });
  return NextResponse.json(prepared);
}
