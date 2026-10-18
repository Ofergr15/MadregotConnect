/**
 * GET /api/photos/browse — the club's photo folders (lib/photos/drive-browse.ts):
 * newest first, each with three signed cover URLs. Any verified member.
 * `{ configured: false }` when the Drive env isn't set (local dev, a preview).
 */
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { FULL, THUMB, listPhotoFolders, signedImageUrl } from '@/lib/photos/drive-browse';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  try {
    const folders = await listPhotoFolders();
    if (!folders) return NextResponse.json({ configured: false, folders: [] });
    return NextResponse.json({
      configured: true,
      folders: folders.map((f, i) => ({
        ...f,
        covers: f.covers.map((id) => signedImageUrl(id, THUMB)).filter(Boolean),
        // The newest folder is the home's big photo — sent at full size.
        ...(i === 0 && f.covers[0] ? { hero: signedImageUrl(f.covers[0], FULL) } : {}),
      })),
    });
  } catch (error) {
    console.error('photos browse failed:', error);
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500 });
  }
}
