import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/public/manifest?t=<invite token> -> the app's manifest, opening on
// /welcome?t=<token> instead of /feed.
//
// Onboarding v2 installs BEFORE signing in (an iPhone's home-screen app does not
// share Safari's login, so a login in Safari would have to be done twice). This
// is what lets the icon a new member just added open on THEIR welcome — "hi Noa,
// a code is on its way" — rather than on a generic sign-in. The same `id` as
// /manifest.json, so it is the same app, not a second one. A phone that ignores
// start_url saves the /join address instead, and /join forwards from there.
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get('t') || '';
  const start = TOKEN.test(t) ? `/welcome?t=${encodeURIComponent(t)}` : '/feed';
  return NextResponse.json({
    id: '/dashboard',
    name: 'Madregot After 2KM',
    short_name: 'Madregot',
    description: 'Running club training platform',
    start_url: start,
    scope: '/',
    display: 'standalone',
    background_color: '#DFDFDF',
    theme_color: '#DFDFDF',
    orientation: 'portrait-primary',
    icons: [
      { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/images/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } });
}
