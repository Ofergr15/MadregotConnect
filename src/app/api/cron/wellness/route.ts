import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sweepWellness } from '@/lib/wellness/sweep';

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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await sweepWellness(createServerClient());
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
