import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { loadTraineeToday } from '@/lib/academy/today-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/today?athleteId=…
 *
 * The academy trainee's home (mockup trainee-experience-v2, phones 1, 1ב, 1ג): today's
 * session (or tomorrow's from 20:00 Israel, dashboard/page.tsx's rule), the rest day with
 * tomorrow under it, the coach's pace update, the test invitation when it is the next
 * thing that matters, how they arrive at the day (form, as of yesterday), last night's
 * sleep and resting HR against their own range, and the race.
 *
 * WHOSE PLAN: the trainee's OWN weekly_plans row for the week, else the club's group plan
 * in their group's variant — never another trainee's (lib/plans/scope.ts `pickPlan`).
 *
 * ONE ROUND of reads, side by side: the cost of this screen on production is the number
 * of round trips (~225 ms each until the Frankfurt move), not the size of any answer. The
 * coach header, unread count, pace update and goal are the /api/academy/me helpers.
 *
 * WHO: the trainee, their coaches, the manager (`mayCoach`). SIDE EFFECT: pricing runs
 * that have no stored load yet (migration 142), bounded, skipped under view-as.
 *
 * The reads and the decisions live in lib/academy/today-server.ts (`loadTraineeToday`),
 * shared with the admin data-coverage check.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { payload } = await loadTraineeToday(supabase, athleteId, { write: !caller.viewingAsBy });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error('Academy today error:', error);
    return NextResponse.json({ error: 'Failed to load today' }, { status: 500 });
  }
}
