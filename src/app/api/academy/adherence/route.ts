import { NextResponse } from 'next/server';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/adherence?weekStart=YYYY-MM-DD&athleteId=xxx
 * Per-academy-athlete compliance for a week: planned vs actual (distance/duration/pace).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const report = await computeAcademyWeekAdherence({
      weekStart: searchParams.get('weekStart'),
      onlyAthleteId: searchParams.get('athleteId'),
    });
    return NextResponse.json(report);
  } catch (error: any) {
    console.error('Academy adherence error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute adherence' }, { status: 500 });
  }
}
