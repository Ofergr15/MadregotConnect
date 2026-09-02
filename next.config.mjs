import createNextIntlPlugin from 'next-intl/plugin';
import { withSerwist } from '@serwist/turbopack';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 blocks cross-origin dev chunks by default. Allow the stable ngrok
  // tunnel used to exercise the local app from physical mobile devices.
  allowedDevOrigins: ['unstout-lustily-noma.ngrok-free.dev', 'madregot.tal.bo'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
};

export default withSerwist(withNextIntl(nextConfig));
