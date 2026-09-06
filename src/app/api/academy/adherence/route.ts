import { NextResponse } from 'next/server';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

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
    const { denied } = await requireCallerForAthlete(request, searchParams.get('athleteId'));
    if (denied) return denied;

    const report = await computeAcademyWeekAdherence({
      weekStart: searchParams.get('weekStart'),
      onlyAthleteId: searchParams.get('athleteId'),
      // The compliance table leads with accuracy, so it needs the verdicts. Only
      // the compact summary crosses the wire — laps stay on this side.
      withExecution: true,
    });
    return NextResponse.json(report);
  } catch (error: any) {
    console.error('Academy adherence error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute adherence' }, { status: 500 });
  }
}
