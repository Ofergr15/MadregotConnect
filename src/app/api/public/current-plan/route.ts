import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// Local-timezone Sunday-of-this-week as YYYY-MM-DD (weeks are Sunday→Saturday).
function currentWeekSunday(): string {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
}

/**
 * GET /api/public/current-plan
 * Returns the group-wide weekly plan for the current week (Sunday-keyed) so an
 * athlete can view/copy their workouts from the profile. Read-only, group plans
 * only (athlete_id IS NULL). Falls back to the most recent past plan if the
 * current week hasn't been published yet.
 */
export async function GET() {
  try {
    const supabase = createServerClient();
    const thisWeek = currentWeekSunday();

    const base = () =>
      supabase
        .from('weekly_plans')
        .select('week_start_date, parsed_workouts, status')
        .eq('coach_id', COACH_ID);

    // Exact current week first.
    let { data } = await base().eq('week_start_date', thisWeek).is('athlete_id', null).maybeSingle();

    // Fallback: most recent published plan at or before this week.
    if (!data) {
      const res = await base()
        .lte('week_start_date', thisWeek)
        .is('athlete_id', null)
        .order('week_start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      data = res.data;
    }

    // athlete_id column may not exist on older DBs — retry unscoped.
    if (!data) {
      const res = await base()
        .lte('week_start_date', thisWeek)
        .order('week_start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      data = res.data;
    }

    if (!data) return NextResponse.json({ plan: null });

    return NextResponse.json({
      plan: {
        week_start_date: data.week_start_date,
        parsed_workouts: data.parsed_workouts,
        status: data.status,
        is_current: data.week_start_date === thisWeek,
      },
    });
  } catch (error: any) {
    console.error('current-plan error:', error);
    return NextResponse.json({ error: error.message || 'Failed to load plan' }, { status: 500 });
  }
}
