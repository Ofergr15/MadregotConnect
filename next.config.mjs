import createNextIntlPlugin from 'next-intl/plugin';
import { withSerwist } from '@serwist/turbopack';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // resvg loads a platform-specific native binding at runtime.
  serverExternalPackages: ['@resvg/resvg-js'],
  // Next 16 blocks cross-origin dev chunks by default. Allow the stable ngrok
  // tunnel used to exercise the local app from physical mobile devices, plus the
  // Mac's own LAN address — a phone on the same network reaches the dev server
  // directly, and without this entry it loads the HTML and none of the chunks.
  // The LAN entry is a wildcard on purpose: the Mac's address is DHCP, so a hard-coded
  // one silently stops working after a lease change and the phone gets HTML with no
  // chunks again — which looks exactly like "the server is down".
  // The `.local` name is the one to hand a phone: Bonjour resolves it to whatever
  // address the Mac holds right now, so it survives a lease change that a hard-coded
  // IP does not (this one moved three times in ten minutes on a corporate network).
  allowedDevOrigins: [
    'unstout-lustily-noma.ngrok-free.dev',
    'madregot.tal.bo',
    'ofer-grosfeld-H265YVFC9G.local',
    '*.local',
    '192.168.*.*',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
  // Anything Next builds (`/_next/static/*`) is content-hashed and already served
  // `immutable`. Files in `public/` are not: Next answers them
  // `public, max-age=0`, so EVERY load — including a plain reload — spends a
  // round trip per file to be told 304. On a phone that is ~6 serialised RTTs
  // (logo, favicon, the touch icon, the landing photos) contending with the API
  // calls the screen is actually waiting for, which is a large part of why a
  // refresh feels like a cold start.
  //
  // These are brand assets that change roughly never, so: instant for a day, then
  // served from cache while a fresh copy is fetched in the background for a week.
  // ⚠️ The cost of that: replacing one of these files does NOT reach a device that
  // already has it for up to a day. If you change a logo or an icon and need it
  // out immediately, change the FILENAME too.
  async headers() {
    return [
      {
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
};

export default withSerwist(withNextIntl(nextConfig));
