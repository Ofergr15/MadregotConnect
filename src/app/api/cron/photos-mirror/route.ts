import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { cronPaused } from '@/lib/cron-pause';
import { mirrorBatch, warmMirrorCache } from '@/lib/photos/mirror';
import { fillVideoTimes } from '@/lib/photos/video-time';
import { forgetLibrary, listVideoFolders, signedVideoUrl } from '@/lib/photos/drive-browse';
import { muxConfigured, syncMuxCopies } from '@/lib/photos/mux';
import { revalidateTag } from 'next/cache';
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
    // When each video was shot (lib/photos/video-time), first: the order of a folder waits
    // on it. A minute a run; the listing is rebuilt when something was found.
    const times = await fillVideoTimes(Date.now() + 60_000).catch((err) => { console.warn('[cron/photos-mirror] times failed', err); return null; });
    if (times?.found) { revalidateTag('photos-library', { expire: 0 }); forgetLibrary(); }
    // The viewing copies at Mux (lib/photos/mux): newest videos first, a few per run.
    let copies: Awaited<ReturnType<typeof syncMuxCopies>> | null = null;
    if (muxConfigured()) {
      try {
        const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://www.madregot.app';
        const list = ((await listVideoFolders()) ?? []).flatMap((f) => [...f.videos].reverse());
        copies = await syncMuxCopies(list.map((v) => ({ id: v.id, ms: v.ms, src: () => { const u = signedVideoUrl(v.id); return u ? `${origin}${u}` : null; } })), Date.now() + 40_000);
        if (copies.ready) revalidateTag('mux-assets', { expire: 0 });
      } catch (err) { console.warn('[cron/photos-mirror] mux failed', err); }
    }
    // Leave room under maxDuration for the manifest write and the reply.
    const result = await mirrorBatch(Date.now() + 120_000);
    // Then every folder's links ahead of the first person to open it (lib/photos/mirror.ts).
    let warmed = 0;
    try {
      const folders = (await listPhotoFolders()) ?? [];
      const ids = await Promise.all(folders.map((f) => listFolderPhotos(f.id).then((r) => (r ? r.photos.map((p) => p.id) : [])).catch(() => [] as string[])));
      warmed = await warmMirrorCache([folders.flatMap((f) => f.covers), ...ids.filter((x) => x.length)], Date.now() + 60_000);
    } catch (err) { console.warn('[cron/photos-mirror] warm failed', err); }
    console.log('[cron/photos-mirror]', { ...result, warmed, times, copies });
    return NextResponse.json({ ...result, warmed, times, copies });
  } catch (error) {
    console.error('[cron/photos-mirror] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export const GET = run;
