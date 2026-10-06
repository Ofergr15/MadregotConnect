import qrcode from 'qrcode-generator';
import { APP_URL } from '@/lib/constants';
import { joinLinkV2 } from '@/lib/install/flag';

export const dynamic = 'force-dynamic';

// GET /api/public/qr?t=<invite token> -> a GIF of the join link (with ?onb=v2).
//
// For the approval mail, read on a computer: "scan this with your phone". An
// image URL because Gmail and Outlook drop inline SVG and data: images. It only
// ever draws this app's own /join link, so it cannot be used to mint a QR code
// for an arbitrary address, and it reveals nothing the link in the same mail
// doesn't already say.
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!TOKEN.test(t)) return new Response('bad token', { status: 400 });
  const q = qrcode(0, 'M');
  q.addData(joinLinkV2(APP_URL, t, true));
  q.make();
  const gif = Buffer.from(q.createDataURL(8, 4).split(',')[1], 'base64');
  return new Response(gif, {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
