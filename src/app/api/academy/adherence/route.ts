import { NextResponse } from 'next/server';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach, visibleTraineeIds } from '@/lib/academy/pairing-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/adherence?weekStart=YYYY-MM-DD&athleteId=xxx
 * Per-academy-athlete compliance for a week: planned vs actual (distance/duration/pace).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // No athleteId means the whole academy's compliance table — staff only.
    // With one, an athlete may pull their own.
    const athleteId = searchParams.get('athleteId');
    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    // One coach's trainees are not another coach's: the whole table is the
    // manager's, a coach gets their own rows, and one athlete needs to be theirs.
    if (athleteId && !(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const visible = athleteId ? null : await visibleTraineeIds(caller, request);

    const report = await computeAcademyWeekAdherence({
      weekStart: searchParams.get('weekStart'),
      onlyAthleteId: searchParams.get('athleteId'),
      // The compliance table leads with accuracy, so it needs the verdicts. Only
      // the compact summary crosses the wire — laps stay on this side.
      withExecution: true,
    });
    return NextResponse.json(visible ? { ...report, athletes: report.athletes.filter(a => visible.has(a.athleteId)) } : report);
  } catch (error: any) {
    console.error('Academy adherence error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute adherence' }, { status: 500 });
  }
}
