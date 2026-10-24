import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { canEdit } from '@/lib/week-setup/model';
import { ownerSectionOf, STEPS, type Step } from '@/lib/week-setup/log';
import { loadOwners, logWeek, whoOf } from '@/lib/week-setup/server';

export const dynamic = 'force-dynamic';

const SUNDAY = /^\d{4}-\d{2}-\d{2}$/;
/** What a week may do without (lib/week-setup/model readiness). */
const SKIPPABLE: Step[] = ['nutrition', 'polls', 'message'];

// POST /api/week-setup/skip { week, step, undo? } — "לא השבוע": this week goes without the
// nutrition PDF, a poll or the message, and the step counts as done; `undo` brings it back.
// In the week's log like every other step, by its owner.
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const week = typeof body?.week === 'string' && SUNDAY.test(body.week) ? body.week : null;
  const step = STEPS.includes(body?.step) ? (body.step as Step) : null;
  if (!week || !step || !SKIPPABLE.includes(step)) return NextResponse.json({ error: 'week and a skippable step are required' }, { status: 400 });
  const supabase = createServerClient();
  const roles = caller.roles ?? [caller.role];
  if (!canEdit(ownerSectionOf(step), await loadOwners(supabase), { admin: caller.isSuperUser || roles.includes('admin'), coach: caller.isStaff })) {
    return NextResponse.json({ error: 'Not yours to change' }, { status: 403 });
  }
  await logWeek(supabase, week, await whoOf(supabase, caller.athleteId), step, body?.undo ? 'unskipped' : 'skipped');
  return NextResponse.json({ ok: true });
}
