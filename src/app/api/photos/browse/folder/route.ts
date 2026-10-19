/**
 * GET /api/photos/browse/folder?id=<driveFolderId> — one photo folder's images, as
 * signed thumbnail and full-size URLs. Only the photos root's own subfolders are
 * ever listed (lib/photos/drive-browse.ts). Any verified member.
 */
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { FULL, THUMB, listFolderPhotos, signedImageUrl } from '@/lib/photos/drive-browse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id') || '';
  try {
    const res = await listFolderPhotos(id);
    if (!res) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    return NextResponse.json({
      folder: res.folder,
      photos: res.photos.map((p) => ({ ...p, thumb: signedImageUrl(p.id, THUMB), full: signedImageUrl(p.id, FULL) })),
    });
  } catch (error) {
    console.error('photos folder failed:', error);
    return NextResponse.json({ error: 'Failed to load the folder' }, { status: 500 });
  }
}
