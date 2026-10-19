/**
 * GET /api/photos/browse/folder?id=<driveFolderId> — one photo folder's images, as
 * signed thumbnail and full-size URLs. Only the photos root's own subfolders are
 * ever listed (lib/photos/drive-browse.ts). Any verified member.
 */
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { FULL, THUMB, listFolderPhotos, signedImageUrl } from '@/lib/photos/drive-browse';
import { mirroredUrls } from '@/lib/photos/mirror';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id') || '';
  try {
    const res = await listFolderPhotos(id);
    if (!res) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    // Our own copy where there is one (lib/photos/mirror.ts), Drive's link where not.
    const m = await mirroredUrls(res.photos.map((p) => p.id));
    return NextResponse.json({
      folder: res.folder,
      photos: res.photos.map((p) => ({
        ...p,
        thumb: m.thumb[p.id] ?? signedImageUrl(p.id, THUMB),
        full: m.full[p.id] ?? signedImageUrl(p.id, FULL),
        blur: m.lqip[p.id] ?? null,
      })),
    });
  } catch (error) {
    console.error('photos folder failed:', error);
    return NextResponse.json({ error: 'Failed to load the folder' }, { status: 500 });
  }
}
