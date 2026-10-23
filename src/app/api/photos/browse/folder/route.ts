/**
 * GET /api/photos/browse/folder?id=<driveFolderId> — one photo folder's images, as
 * signed thumbnail and full-size URLs. Only the photos root's own subfolders are
 * ever listed (lib/photos/drive-browse.ts). Any verified member.
 */
import { after, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { FULL, THUMB, listFolderPhotos, signedImageUrl, signedVideoUrl } from '@/lib/photos/drive-browse';
import { mirroredUrls } from '@/lib/photos/mirror';
import { exifToIso } from '@/lib/photos/video-time';
import { unstable_cache } from 'next/cache';
import { budgetStopped, markFolderWanted, muxConfigured, muxHls, muxPoster, readMuxBudget, readMuxMap, type MuxMap } from '@/lib/photos/mux';

// Which videos have a viewing copy (lib/photos/mux), cached a couple of minutes.
// No copies while the budget guard has them off for the month (lib/photos/mux): the originals play.
const cachedMuxMap = unstable_cache(async (): Promise<MuxMap> => {
  const [map, budget] = await Promise.all([readMuxMap().catch(() => ({})), readMuxBudget().catch(() => null)]);
  return budgetStopped(budget) ? {} : map;
}, ['mux-assets-v2'], { revalidate: 120, tags: ['mux-assets'] });

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id') || '';
  try {
    const t0 = Date.now();
    const res = await listFolderPhotos(id);
    const tList = Date.now() - t0;
    if (!res) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    // Our own copy where there is one (lib/photos/mirror.ts), Drive's link where not.
    const [m, copies] = await Promise.all([
      mirroredUrls([...res.photos.map((p) => p.id), ...res.videos.map((v) => v.id)]),
      res.videos.length ? cachedMuxMap() : Promise.resolve({} as MuxMap),
    ]);
    // A video here with no copy yet: this folder goes to the front of the copy queue.
    if (muxConfigured() && res.videos.some((v) => !copies[v.id])) after(() => markFolderWanted(id).catch(() => {}));
    console.log(`[photos/folder] list ${tList}ms · links ${Date.now() - t0 - tList}ms · ${res.photos.length} photos · ${res.videos.length} videos`);
    return NextResponse.json({
      folder: res.folder,
      photos: res.photos.map((p) => ({
        ...p,
        thumb: m.thumb[p.id] ?? signedImageUrl(p.id, THUMB),
        full: m.full[p.id] ?? signedImageUrl(p.id, FULL),
        blur: m.lqip[p.id] ?? null,
        // When it was shot, as an instant — the one clock photos and videos share, so
        // "הכל" can lay the session out in the order it happened.
        t: exifToIso(p.at),
      })),
      // Each video: its poster (Drive's thumbnail, our copy when there is one) and where it
      // plays from — nothing is fetched until it is opened (mockup photos-videos).
      videos: res.videos.map((v) => ({
        id: v.id, ms: v.ms, w: v.w, h: v.h, at: v.at, t: exifToIso(v.at),
        thumb: m.thumb[v.id] ?? signedImageUrl(v.id, THUMB),
        // Our own copy first: ready on our CDN. Mux makes its still on the first ask (1.5–2.4 s
        // measured 10-23), so it is only for a video we have not copied yet.
        poster: m.full[v.id] ?? muxPoster(copies[v.id]) ?? signedImageUrl(v.id, FULL),
        blur: m.lqip[v.id] ?? null,
        src: signedVideoUrl(v.id),
        // The viewing copy, when Mux has made it: plays at once on any phone (its first
        // frame is the poster, above).
        hls: muxHls(copies[v.id]),
      })),
    });
  } catch (error) {
    console.error('photos folder failed:', error);
    return NextResponse.json({ error: 'Failed to load the folder' }, { status: 500 });
  }
}
