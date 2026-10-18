/**
 * GET /api/photos/browse/img?id&s&e&sig — one club photo, streamed from Drive.
 *
 * No session check here: an <img> can't send the bearer token. The URL is the
 * credential instead — signed for this file and size by the member-gated browse
 * routes (which list only the photos root's own folders), and expiring
 * (lib/photos/drive-browse.ts).
 */
import { NextResponse } from 'next/server';
import { fetchPhotoImage, verifyImageUrl } from '@/lib/photos/drive-browse';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get('id') || '';
  const size = Number(q.get('s'));
  const exp = Number(q.get('e'));
  if (!verifyImageUrl(id, size, exp, q.get('sig') || '')) {
    return NextResponse.json({ error: 'Link expired' }, { status: 403 });
  }
  const img = await fetchPhotoImage(id, size).catch(() => null);
  if (!img) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(img.body, {
    headers: { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=21600, immutable' },
  });
}
