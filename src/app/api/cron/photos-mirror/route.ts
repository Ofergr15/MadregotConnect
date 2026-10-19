import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { cronPaused } from '@/lib/cron-pause';
import { mirrorBatch } from '@/lib/photos/mirror';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/photos-mirror — copies the next batch of club photos from Drive into
 * our storage (lib/photos/mirror.ts). Off until app_settings `photos_mirror` = 'on':
 * the first full copy is a few GB and is meant to land in the database the app runs
 * on after the Frankfurt move, not to be copied across in the move's window.
 * Secured with CRON_SECRET like the other crons.
 */
async function run(request: Request) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data } = await createServerClient().from('app_settings').select('value').eq('key', 'photos_mirror').maybeSingle();
  if (data?.value !== 'on') return NextResponse.json({ enabled: false });
  try {
    // Leave room under maxDuration for the manifest write and the reply.
    const result = await mirrorBatch(Date.now() + 240_000);
    console.log('[cron/photos-mirror]', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/photos-mirror] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export const GET = run;
