import { withoutDraftsFor } from '@/lib/plans/scope';
import { shiftWeekStart } from '@/lib/utils';
import { withServerTiming } from '@/lib/perf/server-timing';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { WEEKLY_PLANS_TAG } from '@/lib/plans/cache';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { planRowsFilter, prefersPlan, rowsForReader } from '@/lib/plans/scope';
import { rethrowIfDynamicBailout } from '@/lib/dynamic-bailout';
import { getDisplayWeekStart, extractWorkouts, getWorkoutKm, buildWeekBreakdown, dedupeWorkoutsByDay } from '@/lib/plans/workout-parsing';
import { academyOnlyReader, ownPlanRowsCount, withoutOwnRows } from '@/lib/plans/scope-server';
import { daySessionWorkouts, mergeDaySessions } from '@/lib/day-session/week-merge';

// A coach pushes a new plan roughly once a week (weekly_plans has only 10
// rows total, live-verified), so a few minutes of staleness is invisible to
// athletes. Participates in Next's Data Cache instead of forcing dynamic
// rendering on every request. See src/lib/supabase/server.ts for how
// `revalidateSeconds` maps to the underlying fetch's cache behavior.
export const revalidate = 300;

async function handleGET(request: Request) {
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
    // The day sessions depend only on the week, not on anything read below, so they start in
    // the same round trip instead of after it (one DB hop off every Today/home open, native and
    // PWA alike). An academy-only reader's result is still discarded below, exactly as before —
    // and so is its failure: the read is settled here and only rethrown for a reader who would
    // have awaited it before, so a throw still means 500 for them and nothing for anyone else.
    const [{ data: plansDescRaw }, ownCounts, academyOnly, daySessionsAll] = await Promise.all([
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
      daySessionWorkouts(currentWeekStart).then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e })),
    ]);
    const plansDesc = plansDescRaw ? withoutDraftsFor(rowsForReader(withoutOwnRows(plansDescRaw, ownCounts), me, academyOnly), !!caller.isStaff || !!caller.isSuperUser) : plansDescRaw;
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
    let dayWorkouts: Awaited<ReturnType<typeof daySessionWorkouts>> = [];
    if (!academyOnly) {
      if (!daySessionsAll.ok) throw daySessionsAll.e;
      dayWorkouts = daySessionsAll.v;
    }

    // Previous week = 7 days before the DISPLAYED week (keeps the delta correct
    // after the Saturday-evening rollover).
    const previousWeekStartStr = shiftWeekStart(currentWeekStart, -1);
    // Same rule as the current week, for the same reason: a delta against an
    // arbitrary older week is not a week-over-week delta. No previous plan means
    // no comparison, which `weekDelta` already expresses as 0 (the pill hides).
    const prevPlan = uniquePlans.find(p => p.week_start_date === previousWeekStartStr);

    // Per-day distances/types + every session of the displayed week — shared
    // with /api/plans/week so the Program page's arbitrary-week view can never
    // disagree with this dashboard chart's math.
    const { dailyDistances, sessions, typeDistribution, weekTotalMin, weekTotalMax, trainingDays } =
      buildWeekBreakdown(dayWorkouts.length ? mergeDaySessions(currentPlan?.parsed_workouts, dayWorkouts) : currentPlan?.parsed_workouts);

    // Previous week volume
    let prevWeekTotal = 0;
    const prevWorkouts = dedupeWorkoutsByDay(extractWorkouts(prevPlan?.parsed_workouts));
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
      const workouts = dedupeWorkoutsByDay(extractWorkouts(plan.parsed_workouts));
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
    // No plan this week is no comparison (0, the pill hides) — not a -100% "drop" against last week.
    const hasCurrent = !!currentPlan || dayWorkouts.length > 0;
    const weekDelta = hasCurrent && prevWeekTotal > 0 ? Math.round(((currentAvg - prevWeekTotal) / prevWeekTotal) * 100) : 0;

    return NextResponse.json({
      dailyDistances,
      weekTotalMin: Math.round(weekTotalMin * 10) / 10,
      weekTotalMax: Math.round(weekTotalMax * 10) / 10,
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

export const GET = withServerTiming(handleGET);
