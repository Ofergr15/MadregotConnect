import { NextResponse } from 'next/server';
import { computeAcademyWeekAdherence, addDaysStr, sundayOf } from '@/lib/academy/report';
import { sendAcademyWeeklyReport } from '@/lib/email';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { israelNow } from '@/lib/utils';

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

  // Coach-configured delivery: which weekday to send + who receives it.
  const settings = await loadAcademySettings();
  const { recipients, day: reportDay } = settings.report;

  const { searchParams } = new URL(request.url);
  const override = searchParams.get('weekStart');
  const force = searchParams.get('force') === '1'; // testing: bypass the day gate

  // The Vercel cron pings this daily (see vercel.json); only actually send on the
  // coach's chosen weekday (Israel time). ?force=1 or ?weekStart= bypasses for tests.
  if (!override && !force && israelNow().weekday !== reportDay) {
    return NextResponse.json({ sent: false, reason: 'not the configured report day', today: israelNow().weekday, reportDay });
  }

  // Previous completed week: this week's Sunday minus 7 days. Allow ?weekStart= override for testing.
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

  // Send to the coach-configured recipients (comma-joined for nodemailer);
  // falls back to ADMIN_EMAIL inside the mailer when none are set.
  const to = recipients.length > 0 ? recipients.join(', ') : undefined;
  const sent = await sendAcademyWeeklyReport({
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    rows,
    to,
  });

  return NextResponse.json({ sent, weekStart: report.weekStart, athletes: rows.length, recipients: recipients.length || 'default' });
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
