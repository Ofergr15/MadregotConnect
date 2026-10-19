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
  // Cached by the CDN as well as the browser, until the link itself expires. The URL is
  // the credential (signed, expiring) and the cache is keyed by the whole URL, so the
  // CDN holds nothing a link holder couldn't fetch anyway — and a photo already seen by
  // anyone is served from the edge in tens of ms, without a function, Drive or Google.
  // It used to be `private`: every view of every photo went to Drive twice in a row.
  const ttl = Math.max(0, Math.min(exp - Math.floor(Date.now() / 1000), 12 * 3600));
  return new NextResponse(img.body, {
    headers: {
      'Content-Type': img.type,
      'Cache-Control': `public, max-age=${ttl}, immutable`,
      'CDN-Cache-Control': `public, max-age=${ttl}`,
    },
  });
}
