import { NextResponse } from 'next/server';
import { computeAcademyWeekAdherence, addDaysStr, sundayOf } from '@/lib/academy/report';
import { sendAcademyWeeklyReport } from '@/lib/email';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { israelNow } from '@/lib/utils';
import { cronPaused } from '@/lib/cron-pause';
import { createServerClient } from '@/lib/supabase/server';
import { allAcademyTraineeIds } from '@/lib/academy/book-server';
import { sweepActivityLoads, type SweepResult } from '@/lib/academy/load-server';

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
 *
 * Every day, report day or not, it then prices the trainees' missing activity loads
 * (migration 142, lib/academy/load-server.ts) within a 25 s budget, so the coach's
 * readiness board is complete for trainees who never open the app. That step never
 * fails the cron: its errors are logged and its result rides in the JSON as `loads`.
 */
async function run(request: Request) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // A failed report must not cost the trainees their nightly loads, nor the reverse.
  let report: Record<string, unknown>;
  let failed = false;
  try {
    report = await weeklyReport(request);
  } catch (err) {
    console.error('academy-report: weekly report failed:', err);
    report = { sent: false, error: err instanceof Error ? err.message : String(err) };
    failed = true;
  }
  const loads = await sweepLoads();
  return NextResponse.json({ ...report, loads }, { status: failed ? 500 : 200 });
}

/** The nightly activity-load step. */
const LOAD_SWEEP_BUDGET_MS = 25_000;

async function sweepLoads(): Promise<SweepResult | { error: string }> {
  try {
    const supabase = createServerClient();
    const athletes = await allAcademyTraineeIds(supabase);
    return await sweepActivityLoads(supabase, { athletes, budgetMs: LOAD_SWEEP_BUDGET_MS });
  } catch (err) {
    console.error('academy-report: activity load sweep failed:', err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The weekly email, as the JSON body the cron answers with. */
async function weeklyReport(request: Request): Promise<Record<string, unknown>> {
  // Coach-configured delivery: which weekday to send + who receives it.
  const settings = await loadAcademySettings();
  const { recipients, day: reportDay } = settings.report;

  const { searchParams } = new URL(request.url);
  const override = searchParams.get('weekStart');
  const force = searchParams.get('force') === '1'; // testing: bypass the day gate

  // The Vercel cron pings this daily (see vercel.json); only actually send on the
  // coach's chosen weekday (Israel time). ?force=1 or ?weekStart= bypasses for tests.
  if (!override && !force && israelNow().weekday !== reportDay) {
    return { sent: false, reason: 'not the configured report day', today: israelNow().weekday, reportDay };
  }

  // Previous completed week: this week's Sunday minus 7 days. Allow ?weekStart= override for testing.
  const weekStart = override ? sundayOf(override) : addDaysStr(sundayOf(null), -7);

  const report = await computeAcademyWeekAdherence({ weekStart });

  if (!report.athletes.length) {
    return { sent: false, reason: 'no academy athletes', weekStart };
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
    return { sent: false, reason: 'no planned workouts', weekStart };
  }

  // Send to the coach-configured recipients (comma-joined for nodemailer);
  // falls back to ADMIN_EMAIL inside the mailer when none are set.
  const to = recipients.length > 0 ? recipients.join(', ') : undefined;
  const result = await sendAcademyWeeklyReport({
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    rows,
    to,
  });

  // `sent` used to be a bare boolean that was true whenever nothing threw — and
  // nothing threw, because Resend resolves refusals. This is a weekly cron whose only
  // reader is a Vercel log, so the reason has to be IN the response or it is lost.
  return {
    sent: result.ok,
    reason: result.ok ? undefined : result.reason,
    weekStart: report.weekStart,
    athletes: rows.length,
    recipients: recipients.length || 'default',
  };
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
