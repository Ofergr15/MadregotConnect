import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityWeekOfPlanWeek, activityWeekStart, planWeekStartOf } from '@/lib/utils';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { visibleTraineeIds } from '@/lib/academy/pairing-server';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { buildTrend, trendWeeks, type TrendWeek } from '@/lib/academy/trends';

export const dynamic = 'force-dynamic';

const MAX_WEEKS = 12;

/**
 * GET /api/academy/trends?weeks=12 — the academy home's chart: trainees, plan
 * completion and km for each of the last N plan weeks (lib/academy/trends.ts).
 *
 * Scoped like everything else: the manager gets the academy, a coach their own
 * trainees. Kilometres are bucketed by the Monday activity week inside each plan
 * week, exactly as /api/academy/members counts "ק״מ השבוע", so the chart's last
 * bar and the number above it agree. Completion is the same adherence report the
 * overview reads, once per week, all weeks in parallel.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    const visible = await visibleTraineeIds(caller, request);
    const count = Math.min(MAX_WEEKS, Math.max(2, Number(new URL(request.url).searchParams.get('weeks')) || MAX_WEEKS));
    const weeks = trendWeeks(planWeekStartOf(), count);

    const supabase = createServerClient();
    const athRes = await supabase
      .from('athletes')
      .select('id, is_academy, approved, academy_joined_on')
      .eq('coach_id', COACH_ID);
    const members = (athRes.error ? [] : athRes.data || [])
      .filter((a: any) => a.is_academy && a.approved !== false && (!visible || visible.has(a.id)));
    const ids = members.map((a: any) => a.id as string);

    // The activity weeks the chart spans, and which plan week each belongs to.
    const planOfActivityWeek = new Map(weeks.map((w) => [activityWeekOfPlanWeek(w), w]));
    const from = [...planOfActivityWeek.keys()].sort()[0];

    const runsRead = (async () => {
      const out: Array<{ weekStart: string; meters: number }> = [];
      if (!ids.length) return out;
      for (let offset = 0; ; offset += 1000) {
        const { data } = await supabase
          .from('athlete_activities')
          .select('distance, start_time')
          .in('athlete_id', ids)
          .gte('start_time', `${from}T00:00:00`)
          .range(offset, offset + 999);
        for (const r of (data || []) as Array<{ distance: number | null; start_time: string | null }>) {
          const plan = r.start_time ? planOfActivityWeek.get(activityWeekStart(r.start_time)) : undefined;
          if (plan) out.push({ weekStart: plan, meters: Number(r.distance) || 0 });
        }
        if (!data || data.length < 1000) break;
      }
      return out;
    })();

    const adherenceRead = Promise.all(weeks.map(async (weekStart) => {
      const report = await computeAcademyWeekAdherence({ weekStart });
      let planned = 0, completed = 0;
      for (const a of report.athletes) {
        if (visible && !visible.has(a.athleteId)) continue;
        planned += a.week.plannedCount ?? 0;
        completed += a.week.completedCount ?? 0;
      }
      return [weekStart, { planned, completed }] as const;
    }));

    const [runs, adherence] = await Promise.all([runsRead, adherenceRead]);
    const series: TrendWeek[] = buildTrend({
      weeks,
      members: members.map((a: any) => ({ joinedOn: a.academy_joined_on ?? null })),
      runs,
      adherence: new Map(adherence),
    });
    return NextResponse.json({ weeks: series, scope: visible ? 'coach' : 'academy' });
  } catch (error) {
    console.error('Academy trends error:', error);
    return NextResponse.json({ error: 'Failed to load the trends' }, { status: 500 });
  }
}
