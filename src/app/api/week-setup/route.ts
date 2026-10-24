import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { loadWeek, weekStartOf } from '@/lib/week-setup/server';
import { canEdit } from '@/lib/week-setup/model';
import { redactLog, stepsOf } from '@/lib/week-setup/log';

export const dynamic = 'force-dynamic';

const SUNDAY = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/week-setup?week=YYYY-MM-DD → the week as "תחילת שבוע" shows it (lib/week-setup),
// and who is asking. Staff only; what each of them may change is decided on the owners.
export async function GET(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get('week') || '';
  const week = SUNDAY.test(raw) ? weekStartOf(raw) : weekStartOf();
  try {
    const week_ = await loadWeek(createServerClient(), week);
    const roles = caller.roles ?? [caller.role];
    const me = { id: caller.athleteId, admin: caller.isSuperUser || roles.includes('admin'), coach: caller.isStaff, approver: caller.canApprove };
    // A coach's own steps whole, the rest as status only (lib/week-setup/log redactLog, 10-24).
    const mine = stepsOf((sec) => canEdit(sec, week_.owners, me));
    return NextResponse.json({
      ...week_,
      log: me.admin ? week_.log : redactLog(week_.log, mine),
      polls: me.admin || mine.includes('polls') ? week_.polls : week_.polls.map((p) => ({ ...p, question: '' })),
      mine,
      me,
    });
  } catch (error) {
    console.error('[week-setup] load failed:', error);
    return NextResponse.json({ error: 'Failed to load the week' }, { status: 500 });
  }
}
