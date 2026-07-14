import { NextResponse } from 'next/server';
import { computeAcademyWeekAdherence, addDaysStr, sundayOf } from '@/lib/academy/report';
import { sendAcademyWeeklyReport } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Weekly academy compliance report to the coach.
 *
 * Scheduled via Vercel Cron (see vercel.json). Reports on the PREVIOUS completed
 * week (the Sunday before this week's Sunday), so it captures a full Sun–Sat.
 *
 * Auth: Vercel attaches `Authorization: Bearer <CRON_SECRET>` to cron calls when
 * CRON_SECRET is set; reject anything else so the public can't trigger emails.
 * Also runnable manually with the same header for testing.
 */
async function run(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Previous completed week: this week's Sunday minus 7 days. Allow ?weekStart= override for testing.
  const { searchParams } = new URL(request.url);
  const override = searchParams.get('weekStart');
  const weekStart = override ? sundayOf(override) : addDaysStr(sundayOf(null), -7);

  const report = await computeAcademyWeekAdherence({ weekStart });

  if (!report.athletes.length) {
    return NextResponse.json({ sent: false, reason: 'no academy athletes', weekStart });
  }

  const rows = report.athletes.map(a => ({
    name: a.name,
    completedCount: a.week.completedCount,
    plannedCount: a.week.plannedCount,
    completionRate: a.week.completionRate,
    avgScore: a.week.avgScore,
  }));

  // Nothing planned for anyone → skip the email (avoids empty digests in off-weeks).
  const anyPlanned = rows.some(r => r.plannedCount > 0);
  if (!anyPlanned) {
    return NextResponse.json({ sent: false, reason: 'no planned workouts', weekStart });
  }

  const sent = await sendAcademyWeeklyReport({
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    rows,
  });

  return NextResponse.json({ sent, weekStart: report.weekStart, athletes: rows.length });
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
