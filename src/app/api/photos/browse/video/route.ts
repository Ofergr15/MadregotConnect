/**
 * GET /api/photos/browse/video?id&e&sig — one club video, its original, streamed from
 * Drive in the ranges the player asks for (mockup photos-videos, 2026-10-23).
 *
 * No session check, as with the images: a <video> can't send the bearer token, so the URL
 * is the credential — signed for this file by the member-gated browse routes and expiring
 * (lib/photos/drive-browse). Nothing is fetched until the player asks: the grid shows
 * Drive's poster, and a range request reads only the part being played.
 */
import { NextResponse } from 'next/server';
import { fetchDriveVideo, verifyVideoUrl } from '@/lib/photos/drive-browse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get('id') || '';
  if (!verifyVideoUrl(id, Number(q.get('e')), q.get('sig') || '')) {
    return NextResponse.json({ error: 'Link expired' }, { status: 403 });
  }
  const res = await fetchDriveVideo(id, request.headers.get('range')).catch(() => null);
  if (!res?.body) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const headers = new Headers();
  for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  // The browser's own cache, not the CDN's: ranges of a 100 MB original are not worth the edge.
  headers.set('cache-control', 'private, max-age=21600');
  if (q.get('dl') === '1') headers.set('content-disposition', `attachment; filename="madregot-video.${/quicktime/.test(headers.get('content-type') || '') ? 'mov' : 'mp4'}"`);
  return new NextResponse(res.body, { status: res.status, headers });
}
