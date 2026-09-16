import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { computeAcademyWeekAdherence, sundayOf, addDaysStr } from '@/lib/academy/report';
import { isMissingFeedbackTable } from '@/lib/academy/feedback';
import { buildQueue } from '@/lib/academy/queue';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/queue?weekStart=YYYY-MM-DD → the mentor's queue for that week.
 *
 * Staff only, and unlike the feedback route there is no self-view to fall back to:
 * this answers "of the twenty, whose week do I open first", which is a question
 * only a mentor has. A trainee's version of this week is the feedback they receive.
 *
 * Two reads, not forty: the whole week's adherence in one pass, and the whole
 * week's feedback in one query. Asking per trainee — which is all the existing
 * feedback GET can do, since it requires an athleteId — would be a request per
 * name, and a queue that loads slower than the list it replaces does not get used.
 */
export async function GET(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const weekStart = sundayOf(searchParams.get('weekStart'));
    const weekEnd = addDaysStr(weekStart, 6);

    // `withExecution` because the queue prints the same accuracy the trainee sees
    // on the run itself — two surfaces disagreeing about one workout is the
    // failure this whole feature exists to end.
    const report = await computeAcademyWeekAdherence({ weekStart, withExecution: true });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_workout_feedback')
      .select('athlete_id, workout_date')
      .gte('workout_date', weekStart)
      .lte('workout_date', weekEnd);

    // Migration 103 is applied by hand. Until it is, every row reads as unreviewed —
    // which is TRUE: a club with no feedback table has reviewed nothing. Any other
    // error is a real failure and says so, because silently sorting a queue wrong is
    // worse than not showing it.
    if (error && !isMissingFeedbackTable(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const unmigrated = !!error;
    const reviewed = new Set(
      (data ?? []).map((r: { athlete_id: string; workout_date: string }) =>
        `${r.athlete_id}|${r.workout_date}`),
    );

    return NextResponse.json({ ...buildQueue(report, reviewed), unmigrated });
  } catch (error: any) {
    console.error('Academy queue error:', error);
    return NextResponse.json({ error: error.message || 'Failed to build the queue' }, { status: 500 });
  }
}
