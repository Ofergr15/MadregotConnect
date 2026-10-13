import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { visibleTraineeIds } from '@/lib/academy/pairing-server';
import { computeAcademyWeekAdherence, sundayOf, addDaysStr } from '@/lib/academy/report';
import { isMissingFeedbackTable } from '@/lib/academy/feedback';
import { buildQueue } from '@/lib/academy/queue';
import { activityLocalDateStr, israelToday } from '@/lib/utils';

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
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    // "Whose week do I open first" — of MY trainees, for a coach.
    const visible = await visibleTraineeIds(caller, request);

    const { searchParams } = new URL(request.url);
    const weekStart = sundayOf(searchParams.get('weekStart'));
    const weekEnd = addDaysStr(weekStart, 6);

    // `withExecution` because the queue prints the same accuracy the trainee sees
    // on the run itself — two surfaces disagreeing about one workout is the
    // failure this whole feature exists to end.
    const full = await computeAcademyWeekAdherence({ weekStart, withExecution: true });
    const report = visible ? { ...full, athletes: full.athletes.filter((a) => visible.has(a.athleteId)) } : full;

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

    const flagged = await flaggedSessions(supabase, report.athletes.map((a) => a.athleteId), weekStart, weekEnd);
    return NextResponse.json({ ...buildQueue(report, reviewed, { today: israelToday(), flagged }), unmigrated });
  } catch (error: any) {
    console.error('Academy queue error:', error);
    return NextResponse.json({ error: error.message || 'Failed to build the queue' }, { status: 500 });
  }
}

/**
 * `athleteId|date` of the week's runs whose post-run report carries pain, a comment or a
 * request for feedback (launch N11) — those go first in the queue. Best-effort: a read
 * that fails flags nothing.
 */
async function flaggedSessions(
  supabase: ReturnType<typeof createServerClient>,
  athleteIds: string[],
  weekStart: string,
  weekEnd: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!athleteIds.length) return out;
  try {
    const { data: fb } = await supabase
      .from('workout_feedback')
      .select('athlete_id, garmin_activity_id, pain, comment, wants_feedback')
      .in('athlete_id', athleteIds)
      .gte('created_at', `${weekStart}T00:00:00Z`);
    const rows = ((fb || []) as Array<{ athlete_id: string; garmin_activity_id: number | null; pain: boolean | null; comment: string | null; wants_feedback: boolean | null }>)
      .filter((r) => r.garmin_activity_id && (r.pain || r.wants_feedback || (r.comment || '').trim()));
    if (!rows.length) return out;
    const { data: acts } = await supabase
      .from('athlete_activities')
      .select('athlete_id, garmin_activity_id, start_time')
      .in('garmin_activity_id', rows.map((r) => r.garmin_activity_id as number));
    const dateOf = new Map(((acts || []) as Array<{ athlete_id: string; garmin_activity_id: number; start_time: string }>)
      .map((a) => [`${a.athlete_id}|${a.garmin_activity_id}`, activityLocalDateStr(a.start_time)]));
    for (const r of rows) {
      const d = dateOf.get(`${r.athlete_id}|${r.garmin_activity_id}`);
      if (d && d >= weekStart && d <= weekEnd) out.add(`${r.athlete_id}|${d}`);
    }
  } catch { /* nothing flagged */ }
  return out;
}
