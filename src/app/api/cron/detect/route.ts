import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { runDetectors } from '@/lib/bugs/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The nightly detector pass — see `lib/bugs/detectors.ts` for what it looks for
 * and, more importantly, for the four rules that keep it from becoming noise.
 *
 * Runs at 03:12 rather than on the hour: the 5-minute sync cron and the badge
 * sweep already own the round numbers, and a detector reading half-written data
 * would spend its first week reporting the other crons' intermediate states.
 *
 * Secured with CRON_SECRET like every other cron. Nothing here writes to an
 * athlete-visible surface and nothing is sent to anybody — the whole output is
 * rows on the coach's own reports board.
 */
async function run(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();
  try {
    const result = await runDetectors(supabase);
    return NextResponse.json({
      ok: true,
      // Summarised, not dumped: the findings themselves are on the board, and a
      // cron log full of Hebrew evidence prose is not where anybody reads them.
      findings: result.findings.length,
      opened: result.opened,
      refreshed: result.refreshed,
      weak: result.findings.filter(f => f.strength === 'weak').length,
      detectors: result.findings.map(f => f.detector),
      skipped: result.skipped,
      // Says so out loud rather than reporting a cheerful zero: until migration
      // 117 is applied there is nowhere to file a finding, so a pass that found
      // three things and stored none must not look like a quiet night.
      storageMissing: result.storageMissing,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'detect-failed' },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
