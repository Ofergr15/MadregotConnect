import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { isAcademyManager, visibleTraineeIds } from '@/lib/academy/pairing-server';
import { loadCompletion } from '@/lib/academy/completion-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/completion — "השלמת פרטים" (mockup academy-existing-trainees, phone 1):
 * every trainee already in the academy, what each is missing (test, band, coach, goal), and
 * how many are ready. lib/academy/completion.ts decides; lib/academy/completion-server.ts reads.
 *
 * STAFF ONLY, scoped like the home: the manager sees the academy, a coach their own trainees,
 * `?scope=coach` narrows a manager. Read-only, so view-as answers it as the viewed coach.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    const visible = await visibleTraineeIds(caller, request);
    const payload = await loadCompletion(createServerClient(), visible, israelToday());
    if ('error' in payload) return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
    return NextResponse.json({
      ...payload,
      scope: visible ? 'coach' : 'academy',
      // The band and coach rows of the form are the manager's to change (PUT /api/academy/bands,
      // PUT /api/academy/coach refuse anybody else); a coach sees them read-only.
      canAssign: isAcademyManager(caller) && !visible,
    });
  } catch (err) {
    console.error('GET /api/academy/completion error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
