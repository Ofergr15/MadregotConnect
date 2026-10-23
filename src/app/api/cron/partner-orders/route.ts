import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { cronPaused } from '@/lib/cron-pause';
import { syncPartnerOrders } from '@/lib/partner-orders/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Daily read of the club's mailbox for partner order emails — see lib/partner-orders/sync.ts.
 * 04:20 UTC, clear of the round-number crons. `?all=1` reads the whole mailbox (the backfill).
 * Secured with CRON_SECRET like every other cron.
 */
async function run(request: Request) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const all = new URL(request.url).searchParams.get('all') === '1';
    const result = await syncPartnerOrders(createServerClient(), all ? null : 45);
    console.log('[partner-orders]', JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[partner-orders] failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
