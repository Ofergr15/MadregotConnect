import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { planWatchStatus } from '@/lib/plans/watch-status';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET ?planId=…&weekStart=YYYY-MM-DD -> { runners, noWatch, planDays }
// The planner's tracking of a week's send (lib/plans/watch-status.ts). Staff only, like the send.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  const q = new URL(request.url).searchParams;
  const planId = q.get('planId') || '';
  const weekStart = q.get('weekStart') || '';
  if (!/^[0-9a-f-]{36}$/i.test(planId) || !DATE.test(weekStart)) return NextResponse.json({ error: 'planId and weekStart required' }, { status: 400 });
  try {
    return NextResponse.json(await planWatchStatus(planId, weekStart));
  } catch (err) {
    console.error('[plans/watch-status] failed:', err);
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 });
  }
}
