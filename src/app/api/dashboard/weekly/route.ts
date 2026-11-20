import { NextResponse } from 'next/server';
import type { ParsedWorkout } from '@/lib/ai/types';
import { createServerClient } from '@/lib/supabase/server';
import { WEEKLY_PLANS_TAG } from '@/lib/plans/cache';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { planRowsFilter, prefersPlan, rowsForReader } from '@/lib/plans/scope';
import { rethrowIfDynamicBailout } from '@/lib/dynamic-bailout';
import { getDisplayWeekStart, extractWorkouts, getWorkoutKm, buildWeekBreakdown, dedupeWorkoutsByDay } from '@/lib/plans/workout-parsing';
import { academyOnlyReader, ownPlanRowsCount, withoutOwnRows } from '@/lib/plans/scope-server';
import { daySessionWorkouts, daySessionWorkoutsByWeek, mergeDaySessions } from '@/lib/day-session/week-merge';

// A coach pushes a new plan roughly once a week (weekly_plans has only 10
// rows total, live-verified), so a few minutes of staleness is invisible to
// athletes. Participates in Next's Data Cache instead of forcing dynamic
// rendering on every request. See src/lib/supabase/server.ts for how
// `revalidateSeconds` maps to the underlying fetch's cache behavior.
export const revalidate = 300;

export async function GET(request: Request) {
  try {
    // The coach's training plan — club-internal, and every athlete reads it, so
    // requireMember rather than requireStaff. Same static-render trade as the
    // leaderboard: the plan queries stay cached for 300s.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    // The group plan plus the caller's own academy week, never another
    // trainee's (lib/plans/scope.ts).
    const me = caller.athleteId;

    const supabase = createServerClient({ revalidateSeconds: 300, cacheTags: [WEEKLY_PLANS_TAG] });
    const now = new Date();
    // Plan week to display — rolls to next week after Saturday 20:00 Israel time.
    const currentWeekStart = getDisplayWeekStart(now);

    // Bounded to the most recent 20 plans — this dashboard only ever renders
    // the current/previous week plus recent history charts (volume trend,
    // long-run progression), none of which need the full all-time history.
    // Fetch newest-first so the LIMIT keeps the recent rows, then restore
    // ascending order for the rest of the function's week-over-week math.
    const [{ data: plansDescRaw }, ownCounts, academyOnly] = await Promise.all([
      supabase
        .from('weekly_plans')
        .select('id, week_start_date, parsed_workouts, status, created_at, athlete_id')
        .eq('coach_id', COACH_ID)
        .or(planRowsFilter(me))
        .order('week_start_date', { ascending: false })
        .limit(20),
      // A trainee who left the academy reads the club's week again (scope-server.ts).
      ownPlanRowsCount(me),
      // An academy-only trainee (no club group) gets no club rows: their week is their own or none.
      academyOnlyReader(me),
    ]);
    const plansDesc = plansDescRaw ? rowsForReader(withoutOwnRows(plansDescRaw, ownCounts), me, academyOnly) : plansDescRaw;
    const plans = plansDesc ? [...plansDesc].reverse() : plansDesc;

    // Deduplicate plans by week: the caller's own week first, then 'pushed'
    const plansByWeek = new Map<string, typeof plans extends (infer T)[] | null ? T : never>();
    if (plans) {
      for (const plan of plans) {
        const existing = plansByWeek.get(plan.week_start_date);
        if (prefersPlan(plan, existing, me)) {
          plansByWeek.set(plan.week_start_date, plan);
        }
      }
    }
    const uniquePlans = Array.from(plansByWeek.values());

    // ONLY the displayed week's plan. There used to be a fallback here to
    // "whatever the newest plan is" when the displayed week had none — while
    // still returning `currentWeekStart` as the week it belonged to. Every
    // consumer maps `dailyDistances[].dayOfWeek` onto a real date, so an old
    // plan came back wearing this week's dates: the dashboard hero announced a
    // fortnight-old session as "today's workout", the RSVP labelled itself from
    // it, and the "new plan" badge fired off its `created_at`. Live-checked
    // 2026-09-05 — the newest plan was the week of 2026-08-23 and the fallback
    // was doing exactly this in production.
    //
    // `/api/plans/week` has always answered `hasPlan: false` for a week with no
    // plan; this route now agrees with it instead of inventing data.
    const currentPlan = uniquePlans.find(p => p.week_start_date === currentWeekStart);
    // A one-day session the coach typed for a date this week, on a day the plan leaves empty,
    // is a session of the week like any other (lib/day-session/week-merge.ts).
    // The club's one-day sessions are not an academy-only trainee's either.
    const dayWorkouts = academyOnly ? [] : await daySessionWorkouts(currentWeekStart);

    // Previous week = 7 days before the DISPLAYED week (keeps the delta correct
    // after the Saturday-evening rollover).
    const prevWeek = new Date(currentWeekStart);
    prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
    const previousWeekStartStr = prevWeek.toISOString().split('T')[0];
    // Same rule as the current week, for the same reason: a delta against an
    // arbitrary older week is not a week-over-week delta. No previous plan means
    // no comparison, which `weekDelta` already expresses as 0 (the pill hides).
    const prevPlan = uniquePlans.find(p => p.week_start_date === previousWeekStartStr);

    // Per-day distances/types + every session of the displayed week — shared
    // with /api/plans/week so the Program page's arbitrary-week view can never
    // disagree with this dashboard chart's math.
    const { dailyDistances, sessions, typeDistribution, weekTotalMin, weekTotalMax, weekRequiredMin, weekRequiredMax, trainingDays } =
      buildWeekBreakdown(dayWorkouts.length ? mergeDaySessions(currentPlan?.parsed_workouts, dayWorkouts) : currentPlan?.parsed_workouts);

    // Previous week volume, on the SAME basis as this week's range: the same function
    // (buildWeekBreakdown, plan-derived pace bands) over the same inputs (the week's plan
    // merged with that week's published one-day sessions, read the same read-only way).
    // It used getWorkoutKm without the bands and without one-day sessions, so the
    // week-over-week % compared two different estimators over two different sets.
    const prevDayWorkouts = academyOnly ? [] : await daySessionWorkouts(previousWeekStartStr);
    const prev = buildWeekBreakdown(prevDayWorkouts.length
      ? mergeDaySessions(prevPlan?.parsed_workouts, prevDayWorkouts)
      : prevPlan?.parsed_workouts);
    const prevWeekTotal = (prev.weekTotalMin + prev.weekTotalMax) / 2;

    // Weekly volume history + long run progression, on the SAME basis as this week's range
    // and the previous week: buildWeekBreakdown (plan-derived pace bands) over each week's plan
    // merged with that week's published one-day sessions, read once (paged) for the whole span.
    // A week with published one-day sessions but NO weekly plan is included (it used to be
    // dropped). If the one-day sessions could not be read, the history is plan-only and
    // `historyCoverage.daySessions` says 'unavailable': absence is never reported as zero.
    // Coverage is bounded to [first plan week, last plan week] ∪ weeks that have plans; one-day
    // sessions outside that span are not read here (`historyCoverage.span`).
    const weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }> = [];
    const longRunProgression: Array<{ week: string; distance: number }> = [];
    const planByWeek = new Map(uniquePlans.map((p) => [p.week_start_date, p]));
    const planWeeks = [...planByWeek.keys()].sort();
    const span = planWeeks.length ? { from: planWeeks[0], to: planWeeks[planWeeks.length - 1] } : null;
    const daySpan = academyOnly || !span
      ? ({ ok: true, byWeek: new Map<string, ParsedWorkout[]>() } as const)
      : await daySessionWorkoutsByWeek(span.from, span.to);
    const historyDays = daySpan.ok ? daySpan.byWeek : new Map<string, ParsedWorkout[]>();
    const historyWeeks = [...new Set([...planWeeks, ...historyDays.keys()])].sort();
    for (const week of historyWeeks) {
      const plan = planByWeek.get(week);
      const days = historyDays.get(week) ?? [];
      if (extractWorkouts(plan?.parsed_workouts).length === 0 && days.length === 0) continue;
      const b = buildWeekBreakdown(days.length ? mergeDaySessions(plan?.parsed_workouts, days) : plan?.parsed_workouts);
      const vol = (b.weekTotalMin + b.weekTotalMax) / 2;
      const maxDist = b.sessions.reduce((m, x) => Math.max(m, (x.kmMin + x.kmMax) / 2), 0);
      weeklyVolumes.push({ week, volume: Math.round(vol * 10) / 10, weekNum: weeklyVolumes.length + 1 });
      longRunProgression.push({ week, distance: Math.round(maxDist * 10) / 10 });
    }
    const historyCoverage = {
      daySessions: academyOnly ? 'not_applicable' : daySpan.ok ? 'included' : 'unavailable',
      span,
    } as const;

    // Week-over-week delta
    const currentAvg = (weekTotalMin + weekTotalMax) / 2;
    const weekDelta = prevWeekTotal > 0 ? Math.round(((currentAvg - prevWeekTotal) / prevWeekTotal) * 100) : 0;

    return NextResponse.json({
      dailyDistances,
      weekTotalMin: Math.round(weekTotalMin * 10) / 10,
      weekTotalMax: Math.round(weekTotalMax * 10) / 10,
      // The week WITHOUT its optional sessions (ParsedWorkout.optional, or "אופציה" in the name):
      // the band a member is "on plan" inside. weekTotalMin/Max above include the optional ones.
      // Additive: computed by buildWeekBreakdown all along, it was simply never sent.
      weekRequiredMin: Math.round(weekRequiredMin * 10) / 10,
      weekRequiredMax: Math.round(weekRequiredMax * 10) / 10,
      weekDelta,
      prevWeekTotal: Math.round(prevWeekTotal * 10) / 10,
      // Whether the displayed week actually HAS a plan. Everything above is
      // zeroed/empty when it doesn't, so a client can tell "no plan pushed yet"
      // apart from "a rest week", and no client has to infer it from a total.
      hasPlan: !!currentPlan || dayWorkouts.length > 0,
      // Whether the week has a weekly plan of its own (not only one-day sessions) — the card's link.
      hasClubPlan: !!currentPlan,
      weeklyVolumes,
      longRunProgression,
      historyCoverage,
      sessions,
      typeDistribution,
      currentWeekStart,
      trainingDays,
      // Lets the dashboard hero card show a "new workouts" badge for a
      // couple of days after the plan first went out.
      publishedAt: currentPlan?.status === 'pushed' ? currentPlan.created_at : null,
    });
  } catch (error) {
    rethrowIfDynamicBailout(error);
    console.error('Weekly dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch weekly data' }, { status: 500 });
  }
}
