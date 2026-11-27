import { NextResponse } from 'next/server';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { toWeekVsPlan } from '@/lib/academy/week-vs-plan';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/week-vs-plan?athleteId=…[&weekStart=YYYY-MM-DD]
 *
 * One trainee's plan week (Sunday-anchored), a row per planned session, with the
 * four engines' answers kept apart (lib/academy/week-vs-plan.ts). Used by both the
 * web and native trainee screens.
 *
 * Self-or-staff, and for staff the same pairing rule as /api/academy/adherence:
 * a coach sees their own trainees only. athleteId is required — the club-wide
 * table stays on /api/academy/adherence.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const report = await computeAcademyWeekAdherence({
      weekStart: searchParams.get('weekStart'),
      onlyAthleteId: athleteId,
      keepDetail: true, // server-side only; toWeekVsPlan drops it
    });
    const mine = report.athletes.find((a) => a.athleteId === athleteId);
    const body = mine
      ? toWeekVsPlan(athleteId, report.weekStart, mine.week)
      : { athleteId, weekStart: report.weekStart, plannedCount: 0, completedCount: 0, rows: [] };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: unknown) {
    console.error('GET /api/academy/week-vs-plan error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
