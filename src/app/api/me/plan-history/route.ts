import { NextResponse } from 'next/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { planRowsFilter, prefersPlan, rowsForReader, withoutDraftsFor } from '@/lib/plans/scope';
import { academyOnlyReader, ownPlanRowsCount, withoutOwnRows } from '@/lib/plans/scope-server';
import { extractWorkouts, getWorkoutKm } from '@/lib/plans/workout-parsing';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/plan-history?weeks=12 — the CALLER's own past plan weeks (night queue #80).
 *
 * Self-scoped: the athlete comes from the JWT (requireAthlete) and nowhere else. The rows are chosen by
 * exactly the rules /api/dashboard/weekly reads a week with (planRowsFilter → rowsForReader →
 * withoutDraftsFor → prefersPlan), so history never shows a week the runner was not shown: the club
 * plan, or their own academy week where they have one; never another trainee's; never a draft.
 * /api/plans/history stays the staff tool (raw coach prompt + per-athlete deliveries).
 *
 * → { weeks: [{ weekStart, planId, own, workouts: [{ dayOfWeek, name, kmMin, kmMax }], totalKmMin, totalKmMax }] }
 *   newest first. km is a range because a timed block has no fixed distance (getWorkoutKm).
 */
const MAX_WEEKS = 52;

export async function GET(request: Request) {
  try {
    const auth = await requireAthlete(request);
    if (!auth.ok) return authError(auth);
    const me = auth.user.athleteId;
    const n = Number(new URL(request.url).searchParams.get('weeks') ?? 12);
    const weeks = Number.isFinite(n) ? Math.min(MAX_WEEKS, Math.max(1, Math.floor(n))) : 12;

    const db = createServerClient();
    const [{ data, error }, ownCounts, academyOnly] = await Promise.all([
      db.from('weekly_plans')
        .select('id, week_start_date, parsed_workouts, status, created_at, athlete_id')
        .eq('coach_id', COACH_ID)
        .or(planRowsFilter(me))
        .order('week_start_date', { ascending: false })
        // Two candidate rows a week at most (club + own); a little slack for duplicates.
        .limit(weeks * 3),
      ownPlanRowsCount(me),
      academyOnlyReader(me),
    ]);
    if (error) {
      console.error('[api/me/plan-history]', error);
      return NextResponse.json({ error: 'failed' }, { status: 500 });
    }
    const rows = withoutDraftsFor(rowsForReader(withoutOwnRows(data ?? [], ownCounts), me, academyOnly), false);
    const byWeek = new Map<string, (typeof rows)[number]>();
    for (const r of [...rows].reverse()) if (prefersPlan(r, byWeek.get(r.week_start_date), me)) byWeek.set(r.week_start_date, r);

    const out = [...byWeek.values()]
      .sort((a, b) => b.week_start_date.localeCompare(a.week_start_date))
      .slice(0, weeks)
      .map((p) => {
        const r1 = (x: number) => Math.round(x * 10) / 10;
        const workouts = extractWorkouts(p.parsed_workouts).map((w: any) => {
          const km = getWorkoutKm(w);
          return {
            dayOfWeek: typeof w.dayOfWeek === 'number' ? w.dayOfWeek : null,
            name: typeof w.name === 'string' ? w.name : '',
            kmMin: r1(km.min), kmMax: r1(km.max),
          };
        });
        return {
          weekStart: p.week_start_date,
          planId: p.id,
          own: p.athlete_id === me,
          workouts,
          totalKmMin: r1(workouts.reduce((s, w) => s + w.kmMin, 0)),
          totalKmMax: r1(workouts.reduce((s, w) => s + w.kmMax, 0)),
        };
      });
    return NextResponse.json({ weeks: out });
  } catch (err) {
    console.error('[api/me/plan-history]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
