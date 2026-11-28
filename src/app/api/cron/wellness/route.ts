import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sweepWellness } from '@/lib/wellness/sweep';
import { cronPaused } from '@/lib/cron-pause';
import { emptyWellnessShapes } from '@/lib/garmin/client';
import { saveLastSweep, sweepSummary } from '@/lib/wellness/last-sweep';
import { deadlineFrom, readCursor, saveCursor } from '@/lib/cron/budget';
import { israelToday } from '@/lib/utils';
import { withCronRun } from '@/lib/cron/runs';

const WELLNESS_CURSOR_KEY = 'wellness_sweep_cursor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Nightly sleep + resting-HR pull — see lib/wellness/sweep.ts.
 *
 * 05:40 UTC (08:40 in Israel in summer): late enough that most watches have
 * synced the night to the phone, and clear of the round-number crons.
 *
 * Secured with CRON_SECRET like every other cron.
 */
async function run(request: Request) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const outOfTime = deadlineFrom();
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();
  try {
    // Stops at ~270 s (lib/cron/budget.ts) instead of being killed at 300 with nothing
    // written; the cursor makes tomorrow's run start with whoever today's never reached.
    const result = await sweepWellness(supabase, israelToday(), {
      outOfTime,
      cursor: await readCursor(supabase, WELLNESS_CURSOR_KEY),
    });
    await saveCursor(supabase, WELLNESS_CURSOR_KEY, result.cursor);
    // One line per run, so "the cron says 200" can be told apart from "nights were
    // actually stored" in the request logs (2026-10-11: trainees showed 2 nights in 30).
    // The Vercel CLI shows only a request's first log line, so the same summary is also
    // kept in app_settings (lib/wellness/last-sweep.ts) for /dashboard/data-check.
    const summary = sweepSummary(result, emptyWellnessShapes());
    console.log('[wellness-sweep]', JSON.stringify(summary));
    await saveLastSweep(supabase, summary);
    return NextResponse.json({ ok: true, ...result, failed: result.failed.length });
  } catch (error) {
    console.error('Wellness sweep error:', error);
    const message = error instanceof Error ? error.message : 'wellness-failed';
    // A failed run still leaves its line on data-check, or the screen shows an old sweep.
    await saveLastSweep(supabase, {
      ...sweepSummary({ athletes: 0, fetched: 0, stored: 0, nightErrors: 0, failed: [] }, emptyWellnessShapes()),
      error: message.slice(0, 200),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withCronRun('wellness', run);
export const POST = withCronRun('wellness', run);
