/**
 * GET /api/photos/browse — the club's photo folders (lib/photos/drive-browse.ts):
 * pinned first (the event of the moment), then newest first, each with three
 * signed cover URLs. Any verified member.
 * `{ configured: false }` when the Drive env isn't set (local dev, a preview).
 */
import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { isFeatureEnabled } from '@/lib/features/server';
import { folderSessions } from '@/lib/photos/status';
import { FULL, THUMB, listPhotoFolders, signedImageUrl } from '@/lib/photos/drive-browse';
import { mirroredUrls } from '@/lib/photos/mirror';

export const dynamic = 'force-dynamic';
// A cold listing walks ~180 Drive folders (~10–20s); after that it is cached.
export const maxDuration = 60;

export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  try {
    const t0 = Date.now();
    const folders = await listPhotoFolders();
    const tList = Date.now() - t0;
    if (!folders) return NextResponse.json({ configured: false, folders: [] });
    // Our own copy where there is one (lib/photos/mirror.ts), Drive's link where not.
    const m = await mirroredUrls([...folders.flatMap((f) => f.covers), ...folders.flatMap((f) => (f.videoCovers ?? []).map((v) => v.id))]);
    // photos_drive_v2 (#101): each folder with what the club did that day (plan workout, events). Off = as before.
    const v2 = await isFeatureEnabled('photos_drive_v2', caller.athleteId).catch(() => false);
    const sessions = v2 ? await folderSessions(createServerClient(), folders.map((f) => f.date)).catch(() => null) : null;
    // Where the time goes, per request (10-19: the page is slow to open).
    console.log(`[photos/browse] list ${tList}ms · links ${Date.now() - t0 - tList}ms · ${folders.length} folders`);
    return NextResponse.json({
      configured: true,
      folders: folders.map((f, i) => ({
        ...f,
        covers: f.covers.map((id) => m.thumb[id] ?? signedImageUrl(id, THUMB)).filter(Boolean),
        coverBlur: f.covers[0] ? m.lqip[f.covers[0]] ?? null : null,
        // The newest few videos' posters, for the "סרטונים" rows (mockup photos-videos, 4).
        videoCovers: (f.videoCovers ?? []).map((v) => ({ id: v.id, ms: v.ms, thumb: m.thumb[v.id] ?? signedImageUrl(v.id, THUMB) })),
        // The first folder (pinned, else the newest) is the home's big photo — sent at full size.
        ...(i === 0 && f.covers[0] ? { hero: m.full[f.covers[0]] ?? signedImageUrl(f.covers[0], FULL) } : {}),
        ...(sessions ? { session: sessions.get(f.date) ?? null } : {}),
      })),
    });
  } catch (error) {
    console.error('photos browse failed:', error);
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500 });
  }
}
