import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sweepWellness } from '@/lib/wellness/sweep';
import { cronPaused } from '@/lib/cron-pause';
import { emptyWellnessShapes } from '@/lib/garmin/client';

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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await sweepWellness(createServerClient());
    // One line per run, so "the cron says 200" can be told apart from "nights were
    // actually stored" in the request logs (2026-10-11: trainees showed 2 nights in 30).
    console.log('[wellness-sweep]', JSON.stringify({
      athletes: result.athletes, fetched: result.fetched, stored: result.stored,
      backfilled: result.backfilled, nightErrors: result.nightErrors,
      failed: result.failed.length, firstFailures: result.failed.slice(0, 3).map(f => f.slice(0, 160)),
      emptyShapes: emptyWellnessShapes(),
    }));
    return NextResponse.json({ ok: true, ...result, failed: result.failed.length });
  } catch (error) {
    console.error('Wellness sweep error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'wellness-failed' },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
