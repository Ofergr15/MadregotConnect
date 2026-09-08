import createNextIntlPlugin from 'next-intl/plugin';
import { withSerwist } from '@serwist/turbopack';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // resvg loads a platform-specific native binding at runtime.
  serverExternalPackages: ['@resvg/resvg-js'],
  // Next 16 blocks cross-origin dev chunks by default. Allow the stable ngrok
  // tunnel used to exercise the local app from physical mobile devices.
  allowedDevOrigins: ['unstout-lustily-noma.ngrok-free.dev', 'madregot.tal.bo'],
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
