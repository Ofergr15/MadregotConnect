import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { cronPaused } from '@/lib/cron-pause';
import { mirrorBatch, warmMirrorCache } from '@/lib/photos/mirror';
import { listFolderPhotos, listPhotoFolders } from '@/lib/photos/drive-browse';

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
    const result = await mirrorBatch(Date.now() + 200_000);
    // Then every folder's links ahead of the first person to open it (lib/photos/mirror.ts).
    let warmed = 0;
    try {
      const folders = (await listPhotoFolders()) ?? [];
      const ids = await Promise.all(folders.map((f) => listFolderPhotos(f.id).then((r) => (r ? r.photos.map((p) => p.id) : [])).catch(() => [] as string[])));
      warmed = await warmMirrorCache([folders.flatMap((f) => f.covers), ...ids.filter((x) => x.length)], Date.now() + 60_000);
    } catch (err) { console.warn('[cron/photos-mirror] warm failed', err); }
    console.log('[cron/photos-mirror]', { ...result, warmed });
    return NextResponse.json({ ...result, warmed });
  } catch (error) {
    console.error('[cron/photos-mirror] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export const GET = run;
