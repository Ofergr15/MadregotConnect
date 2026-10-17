import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { WEEKLY_PLANS_TAG } from '@/lib/plans/cache';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { pickPlan, planRowsFilter } from '@/lib/plans/scope';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import { ownPlanRowsCount, withoutOwnRows } from '@/lib/plans/scope-server';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';
import { groupNumberForAthlete } from '@/lib/plans/match-athlete-activities';

/**
 * Structured breakdown for ONE arbitrary week — the Program page's native
 * training view (replacing the raw PDF iframe). Unlike `/api/dashboard/weekly`
 * (always the currently-displayed week, used by the dashboard chart), this
 * takes a `weekStart` query param so the Program page's week-picker can fetch
 * any past/future week's `weekly_plans` row. `hasPlan: false` tells the
 * frontend to fall back to the `program_weeks` PDF for that week, since not
 * every week has AI-parsed structured data.
 *
 * `lane=mine` (the profile's week card, 2026-10-17): the caller's own pace lane —
 * their pack on that week — instead of lane 1, so the kilometres and paces are the
 * ones they were asked to run. A trainee's own academy plan is already theirs and
 * is returned as is. Without the param nothing changes for the Program page.
 */
export async function GET(req: NextRequest) {
  try {
    // Club-wide training content — every athlete's Program page reads it, so
    // membership is the bar, not staff. Gate before the 400 so an outsider
    // can't distinguish "bad param" from "not allowed".
    const { denied, caller } = await resolveVerifiedCaller(req);
    if (denied) return denied;

    const weekStart = req.nextUrl.searchParams.get('weekStart');
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'weekStart (YYYY-MM-DD) is required' }, { status: 400 });
    }

    const supabase = createServerClient({ revalidateSeconds: 300, cacheTags: [WEEKLY_PLANS_TAG] });
    // A week can have more than one row (e.g. a draft + a pushed version) —
    // prefer 'pushed', same precedence as /api/dashboard/weekly.
    const [{ data: rowsRaw }, ownCounts] = await Promise.all([
      supabase
        .from('weekly_plans')
        .select('parsed_workouts, status, created_at, athlete_id')
        .eq('coach_id', COACH_ID)
        .or(planRowsFilter(caller.athleteId))
        .eq('week_start_date', weekStart),
      // A trainee who left the academy reads the club's week again (scope-server.ts).
      ownPlanRowsCount(caller.athleteId),
    ]);
    const rows = withoutOwnRows(rowsRaw, ownCounts);

    // The caller's own academy week first, never another trainee's (lib/plans/scope.ts).
    const plan = pickPlan(rows, caller.athleteId);

    if (!plan) {
      return NextResponse.json({ hasPlan: false, weekStart, dailyDistances: [], sessions: [], typeDistribution: {}, weekTotalMin: 0, weekTotalMax: 0, trainingDays: 0 });
    }

    let parsed = plan.parsed_workouts;
    let lane: Lane | null = null;
    if (req.nextUrl.searchParams.get('lane') === 'mine' && !plan.athlete_id && caller.athleteId) {
      lane = (await groupNumberForAthlete(supabase, caller.athleteId, weekStart)) as Lane;
      const workouts = laneWorkouts(plan.parsed_workouts, lane);
      // An empty lane would read as "no plan"; lane 1's week is better than none.
      if (workouts.length) parsed = { workouts };
      else lane = null;
    }

    const breakdown = buildWeekBreakdown(parsed);
    // Lets the frontend show a "New" badge for a couple of days after the
    // plan first went out — not athlete-specific (no per-athlete read state
    // exists), but a reasonable proxy since a coach typically pushes once.
    return NextResponse.json({ hasPlan: true, weekStart, publishedAt: plan.status === 'pushed' ? plan.created_at : null, lane, ownPlan: !!plan.athlete_id, ...breakdown });
  } catch (error) {
    console.error('Plan week error:', error);
    return NextResponse.json({ error: 'Failed to fetch week plan' }, { status: 500 });
  }
}
