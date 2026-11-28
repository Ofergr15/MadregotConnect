import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { cronPaused } from '@/lib/cron-pause';
import { dryRunDueComposerItems } from '@/lib/scheduled-composer/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The composer's DRY-RUN sender (task 153, lib/scheduled-composer/server.ts): records what each
// due scheduled message / poll would have sent, and moves it to its next time. Never sends.
// Not in vercel.json yet (owner question in docs/night-questions.md). Gated by CRON_SECRET like every cron.
async function run(request: NextRequest) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await dryRunDueComposerItems(createServerClient()));
  } catch (error) {
    console.error('scheduled-composer dry run failed', error);
    return NextResponse.json({ error: 'dry run failed' }, { status: 500 });
  }
}
export const POST = run;
export const GET = run;
