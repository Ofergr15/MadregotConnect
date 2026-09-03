import type { Metadata, Viewport } from 'next';
import { preload } from 'react-dom';
import { Inter, Heebo } from 'next/font/google';
import { SerwistProvider } from '@serwist/turbopack/react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from './providers';
import { AppSplash } from '@/components/AppSplash';
import { MaintenanceGate } from '@/components/MaintenanceGate';
import { ImpersonationBar } from '@/components/ImpersonationBar';
// UpdatePrompt intentionally unmounted for now — the "new version available"
// bubble was popping too often. Re-enable by restoring this import and the
// <UpdatePrompt /> line below; until then, users refresh manually after deploys.
// import { UpdatePrompt } from '@/components/UpdatePrompt';
import { DevIdentitySwitcher } from '@/components/DevIdentitySwitcher';
import { DevServiceWorkerCleanup } from '@/components/DevServiceWorkerCleanup';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo' });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom left enabled (no maximumScale/userScalable) — disabling it is a
  // WCAG 1.4.4 failure and blocks low-vision users.
  viewportFit: 'cover',
  // Page grey, not the brand blue: the app is on the designer's light system
  // now, so Android's status/URL bar blends into the top of the page instead of
  // sitting on it as a blue band.
  themeColor: '#DFDFDF',
};

export const metadata: Metadata = {
  title: 'Madregot After 2KM',
  description: "Israel's leading running community. Redefining running culture since 2022.",
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    // 'default' (dark glyphs) rather than 'black-translucent' (white glyphs):
    // the light system puts page grey under the status bar, where white iOS
    // glyphs are unreadable. NOTE: this also stops the web view extending
    // beneath the status bar, so it wants one look on a real device — every
    // safe-area-inset-top padding in the app stays valid either way.
    statusBarStyle: 'default',
    title: 'Madregot',
  },
  // `appleWebApp.capable` above emits `mobile-web-app-capable` — the STANDARD
  // name — and nothing else (next/dist/lib/metadata/metadata.js, Next 16.3).
  // Next 14 emitted the apple- prefixed one instead, so the 14→16 upgrade
  // silently dropped the only tag iOS reads before it consults the manifest.
  // An icon added to the home screen after that stopped being a web app and
  // became a plain bookmark that opens in a browser view — which takes
  // standalone, app-native push, and the install-then-tour order (all of which
  // hang off isStandalone()) down with it. So: emit both names, once each.
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
  openGraph: {
    title: 'Madregot After 2KM',
    description: "Israel's leading running community. Redefining running culture since 2022.",
    siteName: 'Madregot After 2KM',
  },
  icons: {
    icon: [
      { url: '/images/favicon.png', sizes: '256x256', type: 'image/png' },
    ],
    apple: [{ url: '/images/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === 'he' ? 'rtl' : 'ltr';

  // AppSplash paints on the very first frame and needs logo.png twice over — an
  // <img> and a CSS mask — so don't leave the browser to discover it from the
  // stylesheet. React's own API rather than a rendered <link rel="preload">:
  // that emitted the tag into <head> twice.
  preload('/images/logo.png', { as: 'image' });

  return (
    <html lang={locale} dir={dir}>
      <body className={`${heebo.variable} ${inter.variable} font-sans`}>
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV === 'development'}
        >
          <NextIntlClientProvider locale={locale} messages={messages} key={locale}>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </SerwistProvider>
        {process.env.NODE_ENV === 'development' && <DevServiceWorkerCleanup />}
        <AppSplash />
        <MaintenanceGate />
        <ImpersonationBar />
        {/* <UpdatePrompt /> — disabled, see note on the import above */}
        <DevIdentitySwitcher />
        <SpeedInsights />
      </body>
    </html>
  );
}
