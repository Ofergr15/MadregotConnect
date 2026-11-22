import { NextRequest, NextResponse } from 'next/server';
import { raceLiveTick } from '@/lib/race-live/server';
import { cronPaused } from '@/lib/cron-pause';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Race-day poller. Called every minute by .github/workflows/race-live.yml (Vercel Hobby crons
// are daily-only). Cheap when nothing is active: one select. Gated by CRON_SECRET like every cron.
async function run(request: NextRequest) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await raceLiveTick());
  } catch (error: any) {
    console.error('race-live tick failed', error);
    return NextResponse.json({ error: error.message || 'tick failed' }, { status: 500 });
  }
}
export const POST = run;
export const GET = run;
