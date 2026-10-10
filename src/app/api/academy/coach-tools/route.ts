import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { visibleTraineeIds } from '@/lib/academy/pairing-server';
import { allAcademyTraineeIds } from '@/lib/academy/book-server';
import { buildCoachTools } from '@/lib/academy/coach-tools-build';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/academy/coach-tools[?scope=coach] — the three new rows of "מחכה לך" (mockup
 * academy-coach-tools.html, phone 1): pace suggestions, missed weeks, and next week empty
 * for N trainees; plus this week's colour squares per trainee.
 *
 * STAFF ONLY, scoped like the members list: the manager sees the academy, a coach sees
 * their own trainees (and `?scope=coach` narrows a manager to theirs).
 *
 * Read-only. Nothing here changes a trainee: every row is a suggestion the coach opens.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const supabase = createServerClient();
    const visible = await visibleTraineeIds(caller, request);
    const ids = visible === null ? await allAcademyTraineeIds(supabase) : [...visible];
    const { context, ...body } = await buildCoachTools(supabase, ids);
    void context;
    return NextResponse.json(body);
  } catch (error) {
    console.error('coach-tools error:', error);
    return NextResponse.json({ error: 'Failed to load the coach tools' }, { status: 500 });
  }
}
