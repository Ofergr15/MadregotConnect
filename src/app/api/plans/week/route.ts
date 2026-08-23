import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';

/**
 * Structured breakdown for ONE arbitrary week — the Program page's native
 * training view (replacing the raw PDF iframe). Unlike `/api/dashboard/weekly`
 * (always the currently-displayed week, used by the dashboard chart), this
 * takes a `weekStart` query param so the Program page's week-picker can fetch
 * any past/future week's `weekly_plans` row. `hasPlan: false` tells the
 * frontend to fall back to the `program_weeks` PDF for that week, since not
 * every week has AI-parsed structured data.
 */
export async function GET(req: NextRequest) {
  try {
    const weekStart = req.nextUrl.searchParams.get('weekStart');
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'weekStart (YYYY-MM-DD) is required' }, { status: 400 });
    }

    const supabase = createServerClient({ revalidateSeconds: 300 });
    // A week can have more than one row (e.g. a draft + a pushed version) —
    // prefer 'pushed', same precedence as /api/dashboard/weekly.
    const { data: rows } = await supabase
      .from('weekly_plans')
      .select('parsed_workouts, status, created_at')
      .eq('coach_id', COACH_ID)
      .eq('week_start_date', weekStart);

    const plan = (rows || []).sort((a, b) => (a.status === 'pushed' ? -1 : b.status === 'pushed' ? 1 : 0))[0];

    if (!plan) {
      return NextResponse.json({ hasPlan: false, weekStart, dailyDistances: [], keySessions: [], typeDistribution: {}, weekTotalMin: 0, weekTotalMax: 0, trainingDays: 0 });
    }

    const breakdown = buildWeekBreakdown(plan.parsed_workouts);
    // Lets the frontend show a "New" badge for a couple of days after the
    // plan first went out — not athlete-specific (no per-athlete read state
    // exists), but a reasonable proxy since a coach typically pushes once.
    return NextResponse.json({ hasPlan: true, weekStart, publishedAt: plan.status === 'pushed' ? plan.created_at : null, ...breakdown });
  } catch (error) {
    console.error('Plan week error:', error);
    return NextResponse.json({ error: 'Failed to fetch week plan' }, { status: 500 });
  }
}
