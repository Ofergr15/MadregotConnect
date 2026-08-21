import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getDisplayWeekStart, extractWorkouts, getWorkoutKm, buildWeekBreakdown } from '@/lib/plans/workout-parsing';

// A coach pushes a new plan roughly once a week (weekly_plans has only 10
// rows total, live-verified), so a few minutes of staleness is invisible to
// athletes. Participates in Next's Data Cache instead of forcing dynamic
// rendering on every request. See src/lib/supabase/server.ts for how
// `revalidateSeconds` maps to the underlying fetch's cache behavior.
export const revalidate = 300;

export async function GET() {
  try {
    const supabase = createServerClient({ revalidateSeconds: 300 });
    const now = new Date();
    // Plan week to display — rolls to next week after Saturday 20:00 Israel time.
    const currentWeekStart = getDisplayWeekStart(now);

    // Bounded to the most recent 20 plans — this dashboard only ever renders
    // the current/previous week plus recent history charts (volume trend,
    // long-run progression), none of which need the full all-time history.
    // Fetch newest-first so the LIMIT keeps the recent rows, then restore
    // ascending order for the rest of the function's week-over-week math.
    const { data: plansDesc } = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, status, created_at')
      .eq('coach_id', COACH_ID)
      .order('week_start_date', { ascending: false })
      .limit(20);
    const plans = plansDesc ? [...plansDesc].reverse() : plansDesc;

    // Deduplicate plans by week (prefer 'pushed' status)
    const plansByWeek = new Map<string, typeof plans extends (infer T)[] | null ? T : never>();
    if (plans) {
      for (const plan of plans) {
        const existing = plansByWeek.get(plan.week_start_date);
        if (!existing || plan.status === 'pushed') {
          plansByWeek.set(plan.week_start_date, plan);
        }
      }
    }
    const uniquePlans = Array.from(plansByWeek.values());

    let currentPlan = uniquePlans.find(p => p.week_start_date === currentWeekStart);
    if (!currentPlan && uniquePlans.length > 0) {
      currentPlan = uniquePlans[uniquePlans.length - 1];
    }

    // Previous week = 7 days before the DISPLAYED week (keeps the delta correct
    // after the Saturday-evening rollover).
    const prevWeek = new Date(currentWeekStart);
    prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
    const previousWeekStartStr = prevWeek.toISOString().split('T')[0];
    let prevPlan = uniquePlans.find(p => p.week_start_date === previousWeekStartStr);
    if (!prevPlan && uniquePlans.length >= 2) {
      prevPlan = uniquePlans[uniquePlans.length - 2];
    }

    // Per-day distances/types + key (non-easy) sessions for the displayed week —
    // shared with /api/plans/week so the Program page's arbitrary-week view can
    // never disagree with this dashboard chart's math.
    const { dailyDistances, keySessions, typeDistribution, weekTotalMin, weekTotalMax, trainingDays } =
      buildWeekBreakdown(currentPlan?.parsed_workouts);

    // Previous week volume
    let prevWeekTotal = 0;
    const prevWorkouts = extractWorkouts(prevPlan?.parsed_workouts).filter((w, i, arr) => arr.findIndex(x => x.dayOfWeek === w.dayOfWeek) === i);
    if (prevWorkouts.length > 0) {
      for (const w of prevWorkouts) {
        const km = getWorkoutKm(w);
        prevWeekTotal += (km.min + km.max) / 2;
      }
    }

    // Weekly volume history + long run progression (longest workout each
    // week) — merged into a single pass over uniquePlans since both derive
    // from the same per-plan extractWorkouts/getWorkoutKm work.
    const weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }> = [];
    const longRunProgression: Array<{ week: string; distance: number }> = [];
    for (const plan of uniquePlans) {
      const workouts = extractWorkouts(plan.parsed_workouts).filter((w, i, arr) => arr.findIndex(x => x.dayOfWeek === w.dayOfWeek) === i);
      if (workouts.length === 0) continue;
      let vol = 0;
      let maxDist = 0;
      for (const w of workouts) {
        const km = getWorkoutKm(w);
        const avg = (km.min + km.max) / 2;
        vol += avg;
        if (avg > maxDist) maxDist = avg;
      }
      weeklyVolumes.push({
        week: plan.week_start_date,
        volume: Math.round(vol * 10) / 10,
        weekNum: weeklyVolumes.length + 1,
      });
      longRunProgression.push({
        week: plan.week_start_date,
        distance: Math.round(maxDist * 10) / 10,
      });
    }

    // Week-over-week delta
    const currentAvg = (weekTotalMin + weekTotalMax) / 2;
    const weekDelta = prevWeekTotal > 0 ? Math.round(((currentAvg - prevWeekTotal) / prevWeekTotal) * 100) : 0;

    return NextResponse.json({
      dailyDistances,
      weekTotalMin: Math.round(weekTotalMin * 10) / 10,
      weekTotalMax: Math.round(weekTotalMax * 10) / 10,
      weekDelta,
      prevWeekTotal,
      weeklyVolumes,
      longRunProgression,
      keySessions,
      typeDistribution,
      currentWeekStart,
      trainingDays,
    });
  } catch (error) {
    console.error('Weekly dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch weekly data' }, { status: 500 });
  }
}
